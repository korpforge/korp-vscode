import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export type SkillMode = 'passive' | 'invoke';

/** Structural pattern, not tool-specific: flat=single .md, directory=folder/SKILL.md, proxy=.agent.md referencing another file */
export type SkillFormat = 'flat' | 'directory' | 'proxy';

export interface Skill {
	id: string;
	name: string;
	description: string;
	source: string;
	format: SkillFormat;
	filePath: string;
	systemPrompt: string;
	enabled: boolean;
	mode: SkillMode;
	trigger: string;
	meta: Record<string, unknown>;
}

interface SkillFrontmatter {
	name?: string;
	description?: string;
	trigger?: string;
	mode?: string;
	tools?: string[];
	model?: string;
	[key: string]: unknown;
}

interface SkillSource {
	id: string;
	path: string;
	format: SkillFormat;
	deprecated?: boolean;
}

const LOG_PREFIX = '[Skills]';

export class SkillRegistry implements vscode.Disposable {
	private _skills = new Map<string, Skill>();
	private _watchers: vscode.FileSystemWatcher[] = [];
	private _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private _disabledIds: Set<string>;
	private _context: vscode.ExtensionContext;
	private _log: vscode.OutputChannel | undefined;

	constructor(context: vscode.ExtensionContext) {
		this._context = context;
		this._disabledIds = new Set(context.globalState.get<string[]>('korp.disabledSkills', []));
	}

	setLog(channel: vscode.OutputChannel): void {
		this._log = channel;
	}

	get skills(): Skill[] {
		return [...this._skills.values()];
	}

	get enabledSkills(): Skill[] {
		return this.skills.filter(s => s.enabled);
	}

	get passiveSkills(): Skill[] {
		return this.enabledSkills.filter(s => s.mode === 'passive');
	}

	get invocableSkills(): Skill[] {
		return this.skills.filter(s => s.mode === 'invoke');
	}

	getSkill(id: string): Skill | undefined {
		return this._skills.get(id);
	}

	matchInvokedSkill(prompt: string): { skill: Skill; remainder: string } | undefined {
		const lower = prompt.toLowerCase().trim();
		const candidates = this.invocableSkills
			.sort((a, b) => b.trigger.length - a.trigger.length);
		for (const skill of candidates) {
			const trigger = skill.trigger.toLowerCase();
			if (lower === trigger || lower.startsWith(trigger + ' ')) {
				const remainder = prompt.trim().slice(skill.trigger.length).trim();
				return { skill, remainder };
			}
		}
		return undefined;
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
		const sources = this._resolveSources();
		for (const source of sources) {
			this._scanSource(source);
		}
		this._setupWatchers(sources);
		this._onDidChange.fire();
		this._log?.appendLine(`${LOG_PREFIX} Loaded ${this._skills.size} skill(s) from ${sources.length} source(s)`);
	}

	private _resolveSources(): SkillSource[] {
		const wsRoot = this._workspaceRoot();
		const sources: SkillSource[] = [];

		// 1. .agents/skills/ (flat .md + dossier/SKILL.md)
		if (wsRoot) {
			sources.push({ id: 'agents-flat', path: path.join(wsRoot, '.agents', 'skills'), format: 'flat' });
			sources.push({ id: 'agents-dir', path: path.join(wsRoot, '.agents', 'skills'), format: 'directory' });
		}

		// 2. .github/agents/ (copilot .agent.md)
		if (wsRoot) {
			sources.push({ id: 'github-copilot', path: path.join(wsRoot, '.github', 'agents'), format: 'proxy' });
		}

		// 3. .korp/skills/ (deprecated)
		if (wsRoot) {
			sources.push({ id: 'korp-legacy', path: path.join(wsRoot, '.korp', 'skills'), format: 'flat', deprecated: true });
		}

		// 4. Global ~/.korp/skills/
		sources.push({ id: 'global', path: path.join(os.homedir(), '.korp', 'skills'), format: 'flat' });

		// 5. Custom sources from settings
		const config = vscode.workspace.getConfiguration('korp');
		const custom = config.get<Array<{ path: string; format: string }>>('skillSources', []);
		for (const entry of custom) {
			const resolvedPath = entry.path.startsWith('/')
				? entry.path
				: wsRoot ? path.join(wsRoot, entry.path) : entry.path;
			const fmt = (['flat', 'directory', 'proxy'].includes(entry.format) ? entry.format : 'flat') as SkillFormat;
			sources.push({ id: `custom:${entry.path}`, path: resolvedPath, format: fmt });
		}

		return sources;
	}

	private _scanSource(source: SkillSource): void {
		if (!fs.existsSync(source.path)) { return; }

		if (source.deprecated) {
			const entries = this._listMdFiles(source.path);
			if (entries.length > 0) {
				this._log?.appendLine(`${LOG_PREFIX} ⚠️ .korp/skills/ is deprecated — move files to .agents/skills/`);
			}
		}

		switch (source.format) {
			case 'flat':
				this._scanFlat(source);
				break;
			case 'directory':
				this._scanDirectorySkills(source);
				break;
			case 'proxy':
				this._scanProxy(source);
				break;
		}
	}

	/** Scan flat .md files (single file = single skill) */
	private _scanFlat(source: SkillSource): void {
		const files = this._listMdFiles(source.path);
		for (const file of files) {
			const filePath = path.join(source.path, file);
			const stat = fs.statSync(filePath);
			if (!stat.isFile()) { continue; }
			const skill = this._parseFlatSkill(filePath, source.id);
			if (skill) {
				this._skills.set(skill.id, skill);
			}
		}
	}

	/** Scan directory-based skills (each subfolder with a SKILL.md entry point) */
	private _scanDirectorySkills(source: SkillSource): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(source.path, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) { continue; }
			const skillFile = path.join(source.path, entry.name, 'SKILL.md');
			if (!fs.existsSync(skillFile)) { continue; }
			const skill = this._parseDirectorySkill(skillFile, entry.name, source.id);
			if (skill) {
				this._skills.set(skill.id, skill);
			}
		}
	}

	/** Scan proxy files (.agent.md that reference another file via LOAD) */
	private _scanProxy(source: SkillSource): void {
		let files: string[];
		try {
			files = fs.readdirSync(source.path).filter(f => f.endsWith('.agent.md'));
		} catch {
			return;
		}
		for (const file of files) {
			const filePath = path.join(source.path, file);
			const skill = this._parseProxySkill(filePath, source);
			if (skill) {
				this._skills.set(skill.id, skill);
			}
		}
	}

	private _parseFlatSkill(filePath: string, sourceId: string): Skill | null {
		let content: string;
		try {
			content = fs.readFileSync(filePath, 'utf-8');
		} catch {
			return null;
		}

		const { frontmatter, body } = parseFrontmatter(content);
		const basename = path.basename(filePath, '.md');
		const id = `${sourceId}:${basename}`;
		const name = frontmatter.name || basename;
		const description = frontmatter.description || '';
		const mode: SkillMode = frontmatter.mode === 'invoke' ? 'invoke' : 'passive';
		const trigger = (frontmatter.trigger as string) || name;

		return {
			id, name, description, source: sourceId, format: 'flat',
			filePath, systemPrompt: body.trim(), enabled: !this._disabledIds.has(id),
			mode, trigger, meta: frontmatter,
		};
	}

	private _parseDirectorySkill(filePath: string, dirName: string, sourceId: string): Skill | null {
		let content: string;
		try {
			content = fs.readFileSync(filePath, 'utf-8');
		} catch {
			return null;
		}

		const { frontmatter, body } = parseFrontmatter(content);
		const id = `${sourceId}:${dirName}`;
		const name = frontmatter.name || dirName;
		const description = frontmatter.description || '';

		return {
			id, name, description, source: sourceId, format: 'directory',
			filePath, systemPrompt: body.trim(), enabled: !this._disabledIds.has(id),
			mode: 'invoke', trigger: frontmatter.trigger || dirName, meta: frontmatter,
		};
	}

	private _parseProxySkill(filePath: string, source: SkillSource): Skill | null {
		let content: string;
		try {
			content = fs.readFileSync(filePath, 'utf-8');
		} catch {
			return null;
		}

		const { frontmatter, body } = parseFrontmatter(content);
		const basename = path.basename(filePath, '.agent.md');
		const id = `${source.id}:${basename}`;
		const description = frontmatter.description || '';

		// Resolve LOAD proxy: if body references a SKILL.md, load that instead
		let systemPrompt = body.trim();
		const loadMatch = systemPrompt.match(/LOAD[^]*?(\{project-root\}\/[^\s,]+SKILL\.md|\.agents\/[^\s,]+SKILL\.md)/i);
		if (loadMatch) {
			const wsRoot = this._workspaceRoot();
			if (wsRoot) {
				const relativePath = loadMatch[1]
					.replace('{project-root}/', '')
					.replace(/^\//, '');
				const resolvedPath = path.join(wsRoot, relativePath);
				try {
					systemPrompt = fs.readFileSync(resolvedPath, 'utf-8');
					const parsed = parseFrontmatter(systemPrompt);
					systemPrompt = parsed.body.trim();
				} catch {
					// Keep original body if resolution fails
				}
			}
		}

		return {
			id, name: basename, description, source: source.id, format: 'proxy',
			filePath, systemPrompt, enabled: !this._disabledIds.has(id),
			mode: 'invoke', trigger: basename, meta: frontmatter,
		};
	}

	private _workspaceRoot(): string | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders?.length) { return undefined; }
		return folders[0].uri.fsPath;
	}

	private _listMdFiles(dir: string): string[] {
		try {
			return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.endsWith('.agent.md'));
		} catch {
			return [];
		}
	}

	private _setupWatchers(sources: SkillSource[]): void {
		this._disposeWatchers();
		const dirs = new Set(sources.map(s => s.path).filter(d => fs.existsSync(d)));
		for (const dir of dirs) {
			const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), '**/*.md');
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
