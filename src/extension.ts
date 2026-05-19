import * as vscode from 'vscode';
import { ChatMessage, GatewayAdapter } from './adapter';
import { OpenClawAdapter } from './gateway';
import { VoiceSession } from './voice';
import { VadSession } from './vad';
import { TtsSession } from './tts';
import { transcribe } from './whisper';
import { SkillRegistry } from './skills';
import { SkillTreeProvider } from './skill-tree';
import { Logger, LogLevel } from './logger';
import { runOnboarding, isOnboarded, resetOnboarding } from './onboarding';

const DEFAULT_GATEWAY_URL = 'http://localhost:18789';
const SECRET_GW_KEY = 'korp.gatewayToken';

let log: Logger;
let voiceLog: Logger;
let chatLog: Logger;

let tts: TtsSession;
let skillRegistry: SkillRegistry;

export function activate(context: vscode.ExtensionContext) {
	// Logger
	log = Logger.init();
	voiceLog = log.child('voice');
	chatLog = log.child('chat');
	log.info('Korp extension activated');

	// Onboarding (first launch)
	if (!isOnboarded(context)) {
		runOnboarding(context);
	}

	const runOnboardingCmd = vscode.commands.registerCommand('korp.runOnboarding', async () => {
		await resetOnboarding(context);
		await runOnboarding(context);
	});

	const toggleLogLevelCmd = vscode.commands.registerCommand('korp.toggleLogLevel', () => {
		const current = Logger.getLevel();
		const next: LogLevel = current === 'debug' ? 'info' : 'debug';
		Logger.setLevel(next);
		const config = vscode.workspace.getConfiguration('korp');
		config.update('logLevel', next, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Korp log level: ${next}`);
	});
	// Skills
	skillRegistry = new SkillRegistry(context);
	skillRegistry.load();

	const skillTree = new SkillTreeProvider(skillRegistry);
	const treeView = vscode.window.createTreeView('korp.skillsView', { treeDataProvider: skillTree });

	const toggleSkillCmd = vscode.commands.registerCommand('korp.toggleSkill', (id: string) => {
		skillRegistry.toggleSkill(id);
	});

	const refreshSkillsCmd = vscode.commands.registerCommand('korp.refreshSkills', () => {
		skillRegistry.load();
	});

	const openSkillCmd = vscode.commands.registerCommand('korp.openSkill', (id: string) => {
		const skill = skillRegistry.getSkill(id);
		if (skill) {
			vscode.window.showTextDocument(vscode.Uri.file(skill.filePath));
		}
	});

	const participant = vscode.chat.createChatParticipant(
		'korpforge.korp',
		(req, ctx, stream, token) => handler(req, ctx, stream, token, context)
	);
	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'korp-icon.png');

	const setGwTokenCmd = vscode.commands.registerCommand('korp.setGatewayToken', async () => {
		const token = await vscode.window.showInputBox({
			prompt: 'Enter your OpenClaw gateway token',
			password: true,
			ignoreFocusOut: true,
		});
		if (token !== undefined) {
			await context.secrets.store(SECRET_GW_KEY, token);
			vscode.window.showInformationMessage('Korp: Gateway token saved securely.');
		}
	});

	// Voice (push-to-talk)
	const voice = new VoiceSession();
	voice.show();
	voice.setOnAudioData(async (wavBuffer) => {
		const config = vscode.workspace.getConfiguration('korp');
		const whisperUrl = config.get<string>('whisperUrl', 'http://localhost:9500');
		voiceLog.info(`[PTT] Audio received: ${wavBuffer.length} bytes`);
		try {
			const result = await transcribe(wavBuffer, whisperUrl);
			if (result) {
				const pct = Math.round(result.confidence * 100);
				voiceLog.info(`[PTT] Text: "${result.text}" | Confidence: ${pct}%`);
				if (result.confidence >= 0.5) {
					const autoSend = result.confidence >= 0.9;
					await vscode.commands.executeCommand('workbench.action.chat.open', {
						query: `@korp ${result.text}`,
						isPartialQuery: !autoSend,
					});
					vscode.window.setStatusBarMessage(`STT: ${pct}%${autoSend ? ' (sent)' : ''}`, 3000);
				} else {
					voiceLog.warn(`[PTT] Rejected (low confidence ${pct}%): "${result.text}"`);
					vscode.window.showWarningMessage(`Korp Voice: Low confidence (${pct}%) — "${result.text}"`);
				}
			} else {
				voiceLog.info('[PTT] No speech detected (filtered)');
				vscode.window.showWarningMessage('Korp Voice: No speech detected.');
			}
		} catch (err: any) {
			voiceLog.error(`[PTT] Transcription error: ${err.message}`);
			vscode.window.showErrorMessage(`Korp Voice: Transcription failed — ${err.message}`);
		}
	});

	const pttCmd = vscode.commands.registerCommand('korp.pushToTalk', () => {
		voice.toggle();
	});

	// VAD (Voice Activity Detection)
	const vad = new VadSession();
	vad.show();
	vad.setOnAudioData(async (wavBuffer) => {
		const config = vscode.workspace.getConfiguration('korp');
		const whisperUrl = config.get<string>('whisperUrl', 'http://localhost:9500');
		voiceLog.info(`[VAD] Audio received: ${wavBuffer.length} bytes`);
		try {
			const result = await transcribe(wavBuffer, whisperUrl);
			if (result) {
				const pct = Math.round(result.confidence * 100);
				voiceLog.info(`[VAD] Text: "${result.text}" | Confidence: ${pct}%`);
				if (result.confidence >= 0.5) {
					const autoSend = result.confidence >= 0.9;
					await vscode.commands.executeCommand('workbench.action.chat.open', {
						query: `@korp ${result.text}`,
						isPartialQuery: !autoSend,
					});
					vscode.window.setStatusBarMessage(`STT: ${pct}%${autoSend ? ' (sent)' : ''}`, 3000);
				} else {
					voiceLog.warn(`[VAD] Rejected (low confidence ${pct}%): "${result.text}"`);
				}
			} else {
				voiceLog.info('[VAD] No speech detected (filtered)');
			}
		} catch (err: any) {
			voiceLog.error(`[VAD] Transcription error: ${err.message}`);
			vscode.window.showErrorMessage(`Korp VAD: Transcription failed — ${err.message}`);
		}
	});

	const toggleVadCmd = vscode.commands.registerCommand('korp.toggleVad', () => {
		vad.toggle();
	});

	// TTS
	tts = new TtsSession();

	const stopSpeakingCmd = vscode.commands.registerCommand('korp.stopSpeaking', () => {
		tts.stop();
	});

	const toggleTtsCmd = vscode.commands.registerCommand('korp.toggleTts', () => {
		const config = vscode.workspace.getConfiguration('korp');
		const current = config.get<boolean>('ttsEnabled', false);
		config.update('ttsEnabled', !current, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Korp TTS: ${!current ? 'enabled' : 'disabled'}`);
	});

	// URI handler for global hotkey: vscode://korpforge.korp/pushToTalk
	const uriHandler = vscode.window.registerUriHandler({
		handleUri(uri: vscode.Uri) {
			if (uri.path === '/pushToTalk') {
				vscode.commands.executeCommand('korp.pushToTalk');
			} else if (uri.path === '/stopSpeaking') {
				vscode.commands.executeCommand('korp.stopSpeaking');
			}
		},
	});

	context.subscriptions.push(participant, setGwTokenCmd, pttCmd, voice, tts, stopSpeakingCmd, toggleTtsCmd, uriHandler, vad, toggleVadCmd, skillRegistry, treeView, toggleSkillCmd, refreshSkillsCmd, openSkillCmd, toggleLogLevelCmd, runOnboardingCmd, log);
}

const COMMAND_PROMPTS: Record<string, string> = {
	explain: 'You are a code explanation assistant. Explain the provided code clearly and concisely. Cover what it does, how it works, and any notable patterns or potential issues.',
	fix: 'You are a code repair assistant. Identify bugs, errors, or issues in the provided code and output the corrected version with a brief explanation of each fix.',
	test: 'You are a test generation assistant. Write unit tests for the provided code using the most appropriate testing framework for the language. Aim for good coverage of edge cases.',
	docs: 'You are a documentation assistant. Generate clear, idiomatic documentation (JSDoc, docstrings, or equivalent) for the provided code. Include parameter descriptions and return values.',
};

const handler = async (
	request: vscode.ChatRequest,
	_context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	extContext: vscode.ExtensionContext
) => {
	const config = vscode.workspace.getConfiguration('korp');
	const gatewayUrl = config.get<string>('gatewayUrl', DEFAULT_GATEWAY_URL);
	const gatewayToken = await extContext.secrets.get(SECRET_GW_KEY);
	const ttsEnabled = config.get<boolean>('ttsEnabled', false);

	chatLog.debug(`Request: command=${request.command || 'none'} prompt="${request.prompt.slice(0, 80)}"`);

	const messages: ChatMessage[] = [];

	// Inject command-specific system prompt
	if (request.command && COMMAND_PROMPTS[request.command]) {
		messages.push({ role: 'system', content: COMMAND_PROMPTS[request.command] });
	}

	// Inject enabled skill prompts
	const activeSkills = skillRegistry.enabledSkills;
	if (activeSkills.length > 0) {
		const skillBlock = activeSkills
			.map(s => `## Skill: ${s.name}\n${s.systemPrompt}`)
			.join('\n\n');
		messages.push({ role: 'system', content: `Active skills:\n\n${skillBlock}` });
	}

	// Add file context if an editor is active
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const doc = editor.document;
		const selection = editor.selection;
		let contextBlock = `File: ${vscode.workspace.asRelativePath(doc.uri)}\nLanguage: ${doc.languageId}\n`;
		if (!selection.isEmpty) {
			const selectedText = doc.getText(selection);
			contextBlock += `\nSelected text (lines ${selection.start.line + 1}-${selection.end.line + 1}):\n\`\`\`\n${selectedText}\n\`\`\``;
		} else {
			const fullText = doc.getText();
			const maxChars = 12000;
			const truncated = fullText.length > maxChars ? fullText.slice(0, maxChars) + '\n…(truncated)' : fullText;
			contextBlock += `\nFull content:\n\`\`\`\n${truncated}\n\`\`\``;
		}
		messages.push({ role: 'system', content: `Active editor context:\n${contextBlock}` });
	}

	// When TTS is on, ask the LLM to include a spoken summary
	if (ttsEnabled) {
		messages.push({ role: 'system', content: 'The user has text-to-speech enabled. At the END of your response, add a concise 1-2 sentence spoken summary inside <spoken>...</spoken> tags. This summary should be natural French speech — no code, no JSON, no markdown. If the answer is already short and natural, just repeat it inside the tag.' });
	}

	const userContent = request.prompt || (request.command && COMMAND_PROMPTS[request.command]
		? `Please ${request.command} the provided code.`
		: 'Hello');
	messages.push({ role: 'user', content: userContent });

	stream.progress('Connecting to OpenClaw gateway…');

	const adapter: GatewayAdapter = new OpenClawAdapter(gatewayUrl, gatewayToken || undefined);
	const abortController = new AbortController();
	token.onCancellationRequested(() => abortController.abort());

	let fullResponse = '';

	return new Promise<void>((resolve) => {
		adapter.streamChat(messages, abortController.signal, {
			onChunk(text) {
				stream.markdown(text);
				fullResponse += text;
			},
			onDone() {
				if (ttsEnabled && fullResponse.trim()) {
					const spokenMatch = fullResponse.match(/<spoken>([\s\S]*?)<\/spoken>/);
					const toSpeak = spokenMatch ? spokenMatch[1].trim() : '';
					if (toSpeak) {
						tts.speak(toSpeak);
					}
				}
				resolve();
			},
			onError(err) {
				if (err === 'Cancelled') {
					resolve();
				} else {
					stream.markdown(`\n\n⚠️ **Gateway error** : ${err}`);
					resolve();
				}
			},
		});
	});
};

export function deactivate() {}
