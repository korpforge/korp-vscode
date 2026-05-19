import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface Skill {
	id: string;
	name: string;
	description: string;
	source: 'workspace' | 'global' | 'github';
	filePath: string;
	systemPrompt: string;
	enabled: boolean;
	meta: Record<string, unknown>;
}

interface SkillFrontmatter {
	name?: string;
	description?: string;
	tools?: string[];
	model?: string;
	[key: string]: unknown;
}

const SKILL_GLOB = '*.md';

export class SkillRegistry implements vscode.Disposable {
	private _skills = new Map<string, Skill>();
	private _watchers: vscode.FileSystemWatcher[] = [];
	private _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private _disabledIds: Set<string>;
	private _context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this._context = context;
		this._disabledIds = new Set(context.globalState.get<string[]>('korp.disabledSkills', []));
	}

	get skills(): Skill[] {
		return [...this._skills.values()];
	}

	get enabledSkills(): Skill[] {
		return this.skills.filter(s => s.enabled);
	}

	getSkill(id: string): Skill | undefined {
		return this._skills.get(id);
	}

	async toggleSkill(id: string): Promise<void> {
		const skill = this._skills.get(id);
		if (!skill) { return; }
		skill.enabled = !skill.enabled;
		if (skill.enabled) {
			this._disabledIds.delete(id);
		} else {
			this._disabledIds.add(id);
		}
		await this._context.globalState.update('korp.disabledSkills', [...this._disabledIds]);
		this._onDidChange.fire();
	}

	async load(): Promise<void> {
		this._skills.clear();
		await Promise.all([
			this._scanDir(this._workspaceSkillsDir(), 'workspace'),
			this._scanDir(this._globalSkillsDir(), 'global'),
			this._scanDir(this._githubAgentsDir(), 'github'),
		]);
		this._setupWatchers();
		this._onDidChange.fire();
	}

	private _workspaceSkillsDir(): string | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders?.length) { return undefined; }
		return path.join(folders[0].uri.fsPath, '.korp', 'skills');
	}

	private _globalSkillsDir(): string {
		return path.join(os.homedir(), '.korp', 'skills');
	}

	private _githubAgentsDir(): string | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders?.length) { return undefined; }
		return path.join(folders[0].uri.fsPath, '.github', 'agents');
	}

	private async _scanDir(dir: string | undefined, source: Skill['source']): Promise<void> {
		if (!dir) { return; }
		let entries: string[];
		try {
			entries = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
		} catch {
			return; // directory doesn't exist
		}
		for (const file of entries) {
			const filePath = path.join(dir, file);
			const skill = this._parseSkillFile(filePath, source);
			if (skill) {
				this._skills.set(skill.id, skill);
			}
		}
	}

	private _parseSkillFile(filePath: string, source: Skill['source']): Skill | null {
		let content: string;
		try {
			content = fs.readFileSync(filePath, 'utf-8');
		} catch {
			return null;
		}

		const { frontmatter, body } = parseFrontmatter(content);
		const basename = path.basename(filePath, '.md');
		const id = `${source}:${basename}`;
		const name = frontmatter.name || basename;
		const description = frontmatter.description || '';

		return {
			id,
			name,
			description,
			source,
			filePath,
			systemPrompt: body.trim(),
			enabled: !this._disabledIds.has(id),
			meta: frontmatter,
		};
	}

	private _setupWatchers(): void {
		this._disposeWatchers();

		const dirs = [
			this._workspaceSkillsDir(),
			this._globalSkillsDir(),
			this._githubAgentsDir(),
		].filter((d): d is string => !!d);

		for (const dir of dirs) {
			const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), SKILL_GLOB);
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			watcher.onDidCreate(() => this.load());
			watcher.onDidChange(() => this.load());
			watcher.onDidDelete(() => this.load());
			this._watchers.push(watcher);
		}
	}

	private _disposeWatchers(): void {
		for (const w of this._watchers) { w.dispose(); }
		this._watchers = [];
	}

	dispose(): void {
		this._disposeWatchers();
		this._onDidChange.dispose();
	}
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!match) {
		return { frontmatter: {}, body: content };
	}
	const raw = match[1];
	const body = match[2];
	const frontmatter: SkillFrontmatter = {};

	// Simple YAML-like parser (key: value per line, supports arrays with - prefix)
	let currentKey = '';
	let currentArray: string[] | null = null;

	for (const line of raw.split(/\r?\n/)) {
		const kvMatch = line.match(/^(\w+)\s*:\s*(.*)$/);
		if (kvMatch) {
			if (currentArray && currentKey) {
				frontmatter[currentKey] = currentArray;
				currentArray = null;
			}
			const [, key, val] = kvMatch;
			if (val.startsWith('[') && val.endsWith(']')) {
				frontmatter[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
			} else if (val === '') {
				currentKey = key;
				currentArray = [];
			} else {
				frontmatter[key] = val.replace(/^["']|["']$/g, '');
			}
		} else if (currentArray !== null) {
			const itemMatch = line.match(/^\s*-\s+(.+)$/);
			if (itemMatch) {
				currentArray.push(itemMatch[1].replace(/^["']|["']$/g, ''));
			}
		}
	}
	if (currentArray && currentKey) {
		frontmatter[currentKey] = currentArray;
	}

	return { frontmatter, body };
}
