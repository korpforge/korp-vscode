import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { tmpdir, userInfo } from 'os';
import { join } from 'path';
import { accessSync, constants } from 'fs';
import { writeFile, unlink } from 'fs/promises';

function getPiperBin(): string {
	const configured = vscode.workspace.getConfiguration('korp').get<string>('piperBin', '');
	return configured || 'piper';
}

export class TtsSession implements vscode.Disposable {
	private process: ChildProcess | undefined;
	private speaking = false;
	private statusBarItem: vscode.StatusBarItem;

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
		this.statusBarItem.command = 'korp.stopSpeaking';
		this.statusBarItem.text = '$(unmute) Korp: Speaking…';
		this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	}

	get isSpeaking(): boolean {
		return this.speaking;
	}

	dispose(): void {
		this.stop();
		this.statusBarItem.dispose();
	}

	async speak(text: string): Promise<void> {
		if (!text.trim()) { return; }
		this.stop();

		const config = vscode.workspace.getConfiguration('korp');
		const piperModel = config.get<string>('ttsModel', '~/.korpforge/models/piper/fr_FR-siwis-medium.onnx')
			.replace(/^~/, userInfo().homedir);

		// Check if model exists
		let modelExists = false;
		try {
			accessSync(piperModel, constants.R_OK);
			modelExists = true;
		} catch { /* model not found */ }

		if (!modelExists) {
			console.error(`[Korp TTS] Model not found: ${piperModel}`);
			return;
		}

		try {
			await this.speakWithPiper(text, piperModel);
		} catch (err: any) {
			console.error(`[Korp TTS] Piper failed: ${err.message}`);
		}
	}

	stop(): void {
		if (this.process) {
			this.process.kill('SIGTERM');
			this.process = undefined;
		}
		this.speaking = false;
		this.statusBarItem.hide();
	}

	private async speakWithPiper(text: string, model: string): Promise<void> {
		const tmpFile = join(tmpdir(), `korp-tts-${Date.now()}.wav`);
		const piperBin = getPiperBin();
		console.log(`[Korp TTS] Using piper: ${piperBin}, model: ${model}`);

		// Generate WAV with piper
		await new Promise<void>((resolve, reject) => {
			const p = spawn(piperBin, ['--model', model, '--output_file', tmpFile], {
				stdio: ['pipe', 'ignore', 'ignore'],
			});
			p.stdin?.write(text);
			p.stdin?.end();
			p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`piper exit ${code}`)));
			p.on('error', reject);
		});

		// Play the WAV
		this.speaking = true;
		this.statusBarItem.show();

		const player = process.platform === 'darwin' ? '/usr/bin/afplay' : 'play';
		return new Promise((resolve) => {
			this.process = spawn(player, [tmpFile]);
			this.process.on('close', () => {
				this.process = undefined;
				this.speaking = false;
				this.statusBarItem.hide();
				unlink(tmpFile).catch(() => {});
				resolve();
			});
			this.process.on('error', () => {
				this.speaking = false;
				this.statusBarItem.hide();
				resolve();
			});
		});
	}

}
