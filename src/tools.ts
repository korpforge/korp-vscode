import * as vscode from 'vscode';
import { ToolDef } from './adapter';
import { Logger } from './logger';

const toolLog = {
	info: (msg: string) => Logger.channel.info(`[tools] ${msg}`),
	debug: (msg: string) => Logger.channel.debug(`[tools] ${msg}`),
	warn: (msg: string) => Logger.channel.warn(`[tools] ${msg}`),
	error: (msg: string) => Logger.channel.error(`[tools] ${msg}`),
};

/** Tool definitions sent to the LLM. */
export const WORKSPACE_TOOLS: ToolDef[] = [
	{
		type: 'function',
		function: {
			name: 'workspace_list_files',
			description:
				'List files and directories at the given path inside the user VS Code workspace. Use "." for the workspace root.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Relative path from the workspace root. Use "." for the root.',
					},
				},
				required: ['path'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'workspace_read_file',
			description:
				'Read the textual content of a file inside the user VS Code workspace. Content is truncated to a safe size.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative path from the workspace root.' },
					max_bytes: {
						type: 'integer',
						description: 'Maximum number of bytes to return (default 32000).',
					},
				},
				required: ['path'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'workspace_find_files',
			description:
				'Find files matching a glob pattern in the user VS Code workspace. Excludes node_modules and .git by default.',
			parameters: {
				type: 'object',
				properties: {
					pattern: {
						type: 'string',
						description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.{js,ts}").',
					},
					max_results: {
						type: 'integer',
						description: 'Maximum number of paths to return (default 100).',
					},
				},
				required: ['pattern'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'workspace_grep',
			description:
				'Search for a substring or regex in workspace files. Returns matching lines with file paths and line numbers.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Substring or regex to search for.' },
					include: {
						type: 'string',
						description: 'Optional glob filter (e.g. "src/**/*.ts").',
					},
					is_regex: {
						type: 'boolean',
						description: 'Treat query as a JS regex when true (default false).',
					},
					max_results: {
						type: 'integer',
						description: 'Maximum number of matches to return (default 50).',
					},
				},
				required: ['query'],
			},
		},
	},
];

const DEFAULT_EXCLUDE = '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/coverage/**,**/.next/**,**/.vscode-test/**}';

function workspaceRoot(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function relUri(relPath: string): vscode.Uri | undefined {
	const root = workspaceRoot();
	if (!root) {
		return undefined;
	}
	const cleaned = relPath.replace(/^\.\/+/, '').replace(/^\/+/, '');
	if (cleaned === '' || cleaned === '.') {
		return root;
	}
	return vscode.Uri.joinPath(root, cleaned);
}

function safeJsonParse<T = Record<string, unknown>>(raw: string): T {
	if (!raw || raw === '{}') {
		return {} as T;
	}
	try {
		return JSON.parse(raw) as T;
	} catch {
		return {} as T;
	}
}

/** Hard cap on tool result size to keep prompt under model context window.
 *  32 KB ≈ ~8 K tokens, leaves plenty of room in a 131 K context window for
 *  multi-turn loops while letting the model see a meaningful chunk of any file. */
const MAX_RESULT_CHARS = 32000;
function capResult(text: string): string {
	if (text.length <= MAX_RESULT_CHARS) { return text; }
	return text.slice(0, MAX_RESULT_CHARS) + `\n\n[TRUNCATED — result capped at ${MAX_RESULT_CHARS} chars; original ${text.length}. Use a more specific query or read by ranges if you need the rest.]`;
}

/** Run a tool and return its result as a string (always a string, per OpenClaw contract). */
export async function executeTool(name: string, argsJson: string): Promise<string> {
	const args = safeJsonParse(argsJson);
	toolLog.debug(`exec ${name}(${argsJson.slice(0, 200)})`);

	try {
		switch (name) {
			case 'workspace_list_files':
				return capResult(await toolListFiles(String(args.path ?? '.')));
			case 'workspace_read_file':
				return capResult(await toolReadFile(String(args.path ?? ''), Number(args.max_bytes) || 32000));
			case 'workspace_find_files':
				return capResult(await toolFindFiles(
					String(args.pattern ?? '**/*'),
					Number(args.max_results) || 50,
				));
			case 'workspace_grep':
				return capResult(await toolGrep(
					String(args.query ?? ''),
					args.include ? String(args.include) : undefined,
					Boolean(args.is_regex),
					Number(args.max_results) || 25,
				));
			default:
				return `Error: unknown tool "${name}".`;
		}
	} catch (err: any) {
		toolLog.error(`${name} failed: ${err?.message ?? err}`);
		return `Error: ${err?.message ?? String(err)}`;
	}
}

/** Human-readable progress label for a tool name (used by the chat UI). */
export function toolProgressLabel(name: string): string {
	const labels: Record<string, string> = {
		workspace_list_files: 'Listing files',
		workspace_read_file: 'Reading file',
		workspace_find_files: 'Finding files',
		workspace_grep: 'Searching workspace',
	};
	return labels[name] ?? name;
}

// ---------- Implementations ----------

async function toolListFiles(relPath: string): Promise<string> {
	const uri = relUri(relPath);
	if (!uri) {
		return 'Error: no workspace folder is open.';
	}
	const entries = await vscode.workspace.fs.readDirectory(uri);
	entries.sort((a, b) => {
		const dirDiff = (b[1] & vscode.FileType.Directory) - (a[1] & vscode.FileType.Directory);
		if (dirDiff !== 0) { return dirDiff; }
		return a[0].localeCompare(b[0]);
	});
	if (entries.length === 0) {
		return '(empty directory)';
	}
	return entries
		.map(([name, type]) => (type & vscode.FileType.Directory ? `${name}/` : name))
		.join('\n');
}

async function toolReadFile(relPath: string, maxBytes: number): Promise<string> {
	const uri = relUri(relPath);
	if (!uri) {
		return 'Error: no workspace folder is open.';
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	let truncated = false;
	let slice: Uint8Array = bytes;
	if (bytes.byteLength > maxBytes) {
		slice = bytes.slice(0, maxBytes);
		truncated = true;
	}
	const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
	if (truncated) {
		// Prepend AND append the truncation marker so the model cannot miss it,
		// regardless of where attention focuses.
		const header = `[TRUNCATED — showing first ${maxBytes} of ${bytes.byteLength} bytes for ${relPath}. Call workspace_read_file again with a larger max_bytes (up to context budget) if you need more.]`;
		return `${header}\n---\n${text}\n---\n${header}`;
	}
	return text;
}

async function toolFindFiles(pattern: string, maxResults: number): Promise<string> {
	const uris = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE, maxResults);
	if (uris.length === 0) {
		return '(no matches)';
	}
	return uris.map(u => vscode.workspace.asRelativePath(u)).join('\n');
}

async function toolGrep(
	query: string,
	include: string | undefined,
	isRegex: boolean,
	maxResults: number,
): Promise<string> {
	if (!query) {
		return 'Error: query is required.';
	}
	const regex = isRegex
		? new RegExp(query)
		: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

	const uris = await vscode.workspace.findFiles(include ?? '**/*', DEFAULT_EXCLUDE, 2000);
	const out: string[] = [];

	for (const uri of uris) {
		if (out.length >= maxResults) { break; }
		let buf: Uint8Array;
		try {
			buf = await vscode.workspace.fs.readFile(uri);
		} catch {
			continue;
		}
		if (buf.byteLength > 1_000_000) { continue; } // skip large/binary files
		const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (regex.test(lines[i])) {
				out.push(`${vscode.workspace.asRelativePath(uri)}:${i + 1}: ${lines[i].slice(0, 240)}`);
				if (out.length >= maxResults) { break; }
			}
		}
	}

	if (out.length === 0) {
		return '(no matches)';
	}
	return out.join('\n');
}
