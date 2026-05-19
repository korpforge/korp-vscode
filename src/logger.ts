import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Structured logger backed by VS Code's LogOutputChannel.
 * Supports scoped child loggers and a runtime-toggleable level.
 */
export class Logger {
	private _channel: vscode.LogOutputChannel;
	private _scope: string;
	private static _level: LogLevel = 'info';

	private constructor(channel: vscode.LogOutputChannel, scope: string) {
		this._channel = channel;
		this._scope = scope;
	}

	private static _instance: Logger | undefined;
	private static _channel: vscode.LogOutputChannel | undefined;

	static init(): Logger {
		const config = vscode.workspace.getConfiguration('korp');
		Logger._level = config.get<LogLevel>('logLevel', 'info');
		Logger._channel = vscode.window.createOutputChannel('Korp', { log: true });
		Logger._instance = new Logger(Logger._channel, 'core');
		return Logger._instance;
	}

	static get channel(): vscode.LogOutputChannel {
		return Logger._channel!;
	}

	static setLevel(level: LogLevel): void {
		Logger._level = level;
	}

	static getLevel(): LogLevel {
		return Logger._level;
	}

	child(scope: string): Logger {
		return new Logger(this._channel, scope);
	}

	debug(msg: string, ...args: unknown[]): void {
		if (LEVEL_ORDER[Logger._level] > LEVEL_ORDER.debug) { return; }
		this._channel.debug(this._fmt(msg), ...args);
	}

	info(msg: string, ...args: unknown[]): void {
		if (LEVEL_ORDER[Logger._level] > LEVEL_ORDER.info) { return; }
		this._channel.info(this._fmt(msg), ...args);
	}

	warn(msg: string, ...args: unknown[]): void {
		if (LEVEL_ORDER[Logger._level] > LEVEL_ORDER.warn) { return; }
		this._channel.warn(this._fmt(msg), ...args);
	}

	error(msg: string, ...args: unknown[]): void {
		this._channel.error(this._fmt(msg), ...args);
	}

	private _fmt(msg: string): string {
		return `[${this._scope}] ${msg}`;
	}

	dispose(): void {
		this._channel.dispose();
	}
}
