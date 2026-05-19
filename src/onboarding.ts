import * as vscode from 'vscode';

const SECRET_GW_KEY = 'korp.gatewayToken';
const ONBOARDED_KEY = 'korp.onboarded';

export async function runOnboarding(context: vscode.ExtensionContext): Promise<boolean> {
	const config = vscode.workspace.getConfiguration('korp');

	// Step 1: Gateway URL
	const gwChoice = await vscode.window.showQuickPick(
		[
			{ label: '$(globe) Use default (localhost:18789)', value: 'default' },
			{ label: '$(pencil) Enter custom URL', value: 'custom' },
		],
		{ title: 'Korp — Gateway URL (1/4)', placeHolder: 'Where is your OpenClaw gateway?', ignoreFocusOut: true }
	);
	if (!gwChoice) { return false; }

	if (gwChoice.value === 'custom') {
		const url = await vscode.window.showInputBox({
			title: 'Korp — Gateway URL (1/4)',
			prompt: 'Enter the OpenClaw gateway URL',
			value: 'http://localhost:18789',
			ignoreFocusOut: true,
			validateInput: (v) => {
				try { new URL(v); return null; } catch { return 'Invalid URL'; }
			},
		});
		if (url === undefined) { return false; }
		await config.update('gatewayUrl', url, vscode.ConfigurationTarget.Global);
	}

	// Step 2: Gateway Token
	const token = await vscode.window.showInputBox({
		title: 'Korp — Gateway Token (2/4)',
		prompt: 'Enter your OpenClaw gateway token (leave empty to skip)',
		password: true,
		ignoreFocusOut: true,
	});
	if (token === undefined) { return false; }
	if (token) {
		await context.secrets.store(SECRET_GW_KEY, token);
	}

	// Step 3: Voice / Whisper STT
	const voiceChoice = await vscode.window.showQuickPick(
		[
			{ label: '$(mic) Yes, enable voice (Whisper STT)', value: 'yes' },
			{ label: '$(close) No, skip voice', value: 'no' },
		],
		{ title: 'Korp — Voice STT (3/4)', placeHolder: 'Enable push-to-talk / VAD?', ignoreFocusOut: true }
	);
	if (!voiceChoice) { return false; }

	if (voiceChoice.value === 'yes') {
		const whisperUrl = await vscode.window.showInputBox({
			title: 'Korp — Whisper URL (3/4)',
			prompt: 'Whisper sidecar URL',
			value: 'http://localhost:9500',
			ignoreFocusOut: true,
			validateInput: (v) => {
				try { new URL(v); return null; } catch { return 'Invalid URL'; }
			},
		});
		if (whisperUrl === undefined) { return false; }
		await config.update('whisperUrl', whisperUrl, vscode.ConfigurationTarget.Global);
	}

	// Step 4: TTS
	const ttsChoice = await vscode.window.showQuickPick(
		[
			{ label: '$(unmute) Yes, enable TTS (Piper)', value: 'yes' },
			{ label: '$(close) No, skip TTS', value: 'no' },
		],
		{ title: 'Korp — Text-to-Speech (4/4)', placeHolder: 'Read responses aloud?', ignoreFocusOut: true }
	);
	if (!ttsChoice) { return false; }

	if (ttsChoice.value === 'yes') {
		await config.update('ttsEnabled', true, vscode.ConfigurationTarget.Global);
	}

	// Done
	await context.globalState.update(ONBOARDED_KEY, 1);
	vscode.window.showInformationMessage('Korp is ready! Type @korp in the Chat panel to start.');
	return true;
}

export function isOnboarded(context: vscode.ExtensionContext): boolean {
	return !!context.globalState.get(ONBOARDED_KEY);
}

export async function resetOnboarding(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(ONBOARDED_KEY, undefined);
}
