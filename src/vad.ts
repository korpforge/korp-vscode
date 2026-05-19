import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';

function getRecBin(): string {
	const configured = vscode.workspace.getConfiguration('korp').get<string>('recBin', '');
	return configured || 'rec';
}

/**
 * Voice Activity Detection session using sox's built-in silence detection.
 * Continuously listens, starts recording when speech is detected,
 * stops when silence returns, then delivers the audio and restarts.
 * Only active when VS Code window has focus and vadEnabled setting is true.
 */
export class VadSession implements vscode.Disposable {
	private listening = false;
	private recProcess: ChildProcess | undefined;
	private statusBarItem: vscode.StatusBarItem;
	private onAudioData: ((wavBuffer: Buffer) => void) | undefined;
	private tmpFile: string = '';
	private disposed = false;
	private focusListener: vscode.Disposable | undefined;
	private blurListener: vscode.Disposable | undefined;
	private configListener: vscode.Disposable | undefined;

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
		this.statusBarItem.command = 'korp.toggleVad';
		this.updateStatusBar();

		// Auto-start/stop based on window focus
		this.focusListener = vscode.window.onDidChangeWindowState((state) => {
			if (state.focused && this.isEnabled() && !this.listening) {
				this.start();
			} else if (!state.focused && this.listening) {
				this.stop();
			}
		});

		// React to setting changes
		this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('korp.vadEnabled')) {
				if (this.isEnabled() && vscode.window.state.focused) {
					this.start();
				} else {
					this.stop();
				}
			}
		});
	}

	get isListening(): boolean {
		return this.listening;
	}

	dispose(): void {
		this.disposed = true;
		this.stop();
		this.statusBarItem.dispose();
		this.focusListener?.dispose();
		this.blurListener?.dispose();
		this.configListener?.dispose();
	}

	show(): void {
		this.statusBarItem.show();
		// Auto-start if enabled and window has focus
		if (this.isEnabled() && vscode.window.state.focused) {
			this.start();
		}
	}

	private isEnabled(): boolean {
		return vscode.workspace.getConfiguration('korp').get<boolean>('vadEnabled', false);
	}

	setOnAudioData(cb: (wavBuffer: Buffer) => void): void {
		this.onAudioData = cb;
	}

	toggle(): void {
		const config = vscode.workspace.getConfiguration('korp');
		const current = config.get<boolean>('vadEnabled', false);
		config.update('vadEnabled', !current, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Korp VAD: ${!current ? 'enabled' : 'disabled'}`);
	}

	start(): void {
		if (this.listening) { return; }
		this.listening = true;
		this.updateStatusBar();
		this.listen();
	}

	stop(): void {
		this.listening = false;
		if (this.recProcess) {
			this.recProcess.kill('SIGTERM');
			this.recProcess = undefined;
		}
		this.updateStatusBar();
	}

	private listen(): void {
		if (!this.listening || this.disposed) { return; }

		this.tmpFile = join(tmpdir(), `korp-vad-${Date.now()}.wav`);
		const recBin = getRecBin();

		// sox silence detection:
		// 1) Skip initial silence: trigger as soon as sound > -35dB for 0.05s
		// 2) Stop recording: when silence returns < -35dB for 1.5s
		// pad 0.3 0: prepend 0.3s of pre-trigger audio to avoid cutting first words
		this.recProcess = spawn(recBin, [
			'-c', '1',
			'-b', '16',
			this.tmpFile,
			'rate', '16000',
			'silence', '1', '0.05', '-35d',
			'1', '1.5', '-35d',
			'pad', '0.3', '0',
		]);

		this.recProcess.on('error', (err) => {
			vscode.window.showErrorMessage(`Korp VAD: rec failed — ${err.message}`);
			this.listening = false;
			this.updateStatusBar();
		});

		this.recProcess.on('close', async () => {
			this.recProcess = undefined;

			if (!this.listening || this.disposed) { return; }

			// Process captured audio
			try {
				const buffer = await readFile(this.tmpFile);
				if (buffer.length > 16044) { // > 0.5s of audio
					this.onAudioData?.(buffer);
				}
			} catch {
				// file may not exist
			} finally {
				unlink(this.tmpFile).catch(() => {});
			}

			// Restart listening for next utterance
			this.listen();
		});
	}

	private updateStatusBar(): void {
		if (this.listening) {
			this.statusBarItem.text = '$(radio-tower) Korp: VAD On';
			this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			this.statusBarItem.text = '$(radio-tower) Korp: VAD Off';
			this.statusBarItem.backgroundColor = undefined;
		}
	}
}
