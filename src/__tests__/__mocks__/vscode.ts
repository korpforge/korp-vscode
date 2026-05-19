// Minimal vscode module mock for unit tests
export const workspace = {
	getConfiguration: () => ({
		get: (key: string, defaultValue: unknown) => defaultValue,
		update: async () => {},
	}),
	workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
	createFileSystemWatcher: () => ({
		onDidCreate: () => ({ dispose: () => {} }),
		onDidChange: () => ({ dispose: () => {} }),
		onDidDelete: () => ({ dispose: () => {} }),
		dispose: () => {},
	}),
};

export const window = {
	createOutputChannel: (name: string, opts?: unknown) => ({
		info: () => {},
		debug: () => {},
		warn: () => {},
		error: () => {},
		append: () => {},
		appendLine: () => {},
		show: () => {},
		dispose: () => {},
	}),
	createTreeView: () => ({ dispose: () => {} }),
	showInformationMessage: () => {},
	showWarningMessage: () => {},
	showErrorMessage: () => {},
};

export class EventEmitter {
	private _listeners: Function[] = [];
	event = (listener: Function) => {
		this._listeners.push(listener);
		return { dispose: () => {} };
	};
	fire(data?: unknown) {
		for (const l of this._listeners) { l(data); }
	}
	dispose() { this._listeners = []; }
}

export const Uri = {
	file: (path: string) => ({ fsPath: path, path }),
	joinPath: (base: unknown, ...parts: string[]) => ({ fsPath: parts.join('/') }),
};

export class ThemeIcon {
	constructor(public id: string, public color?: unknown) {}
}

export class ThemeColor {
	constructor(public id: string) {}
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

export class TreeItem {
	label: string;
	collapsibleState: number;
	description?: string;
	tooltip?: string;
	iconPath?: unknown;
	contextValue?: string;
	command?: unknown;
	constructor(label: string, collapsibleState?: number) {
		this.label = label;
		this.collapsibleState = collapsibleState ?? 0;
	}
}

export const RelativePattern = class {
	constructor(public base: unknown, public pattern: string) {}
};

export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}
