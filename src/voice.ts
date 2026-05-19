import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';

function getRecBin(): string {
	const configured = vscode.workspace.getConfiguration('korp').get<string>('recBin', '');
	return configured || 'rec';
}

export class VoiceSession implements vscode.Disposable {
	private recording = false;
	private recProcess: ChildProcess | undefined;
	private statusBarItem: vscode.StatusBarItem;
	private onAudioData: ((wavBuffer: Buffer) => void) | undefined;
	private tmpFile: string = '';

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.statusBarItem.command = 'korp.pushToTalk';
		this.updateStatusBar();
	}

	get isRecording(): boolean {
		return this.recording;
	}

	dispose(): void {
		this.statusBarItem.dispose();
		this.stopRecording();
	}

	show(): void {
		this.statusBarItem.show();
	}

	setOnAudioData(cb: (wavBuffer: Buffer) => void): void {
		this.onAudioData = cb;
	}

	toggle(): void {
		if (this.recording) {
			this.stopRecording();
		} else {
			this.startRecording();
		}
	}

	private startRecording(): void {
		this.tmpFile = join(tmpdir(), `korp-voice-${Date.now()}.wav`);

		const recBin = getRecBin();

		// Use sox's `rec` command to capture from default mic as 16kHz mono WAV
		this.recProcess = spawn(recBin, [
			'-r', '16000',   // 16kHz sample rate (Whisper expects this)
			'-c', '1',       // mono
			'-b', '16',      // 16-bit
			this.tmpFile,
		]);

		this.recProcess.on('error', (err) => {
			vscode.window.showErrorMessage(`Korp Voice: Failed to start recording. Is sox installed? (${err.message})`);
			this.recording = false;
			this.updateStatusBar();
		});

		this.recProcess.on('close', async () => {
			this.recProcess = undefined;
			if (!this.recording) {
				// Stopped intentionally — read the file
				try {
					const buffer = await readFile(this.tmpFile);
					if (buffer.length > 44) { // WAV header is 44 bytes
						this.onAudioData?.(buffer);
					}
				} catch {
					// file may not exist if recording was too short
				} finally {
					unlink(this.tmpFile).catch(() => {});
				}
			}
		});

		this.recording = true;
		this.updateStatusBar();
	}

	private stopRecording(): void {
		if (this.recProcess) {
			this.recording = false;
			this.updateStatusBar();
			// Send SIGTERM to sox which flushes the WAV header
			this.recProcess.kill('SIGTERM');
		} else {
			this.recording = false;
			this.updateStatusBar();
		}
	}

	private updateStatusBar(): void {
		if (this.recording) {
			this.statusBarItem.text = '$(mic-filled) Korp: Recording…';
			this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			this.statusBarItem.text = '$(mic) Korp: Voice';
			this.statusBarItem.backgroundColor = undefined;
		}
	}
}
