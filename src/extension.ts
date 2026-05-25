import * as vscode from 'vscode';
import { ChatMessage, GatewayAdapter } from './adapter';
import { OpenClawAdapter } from './gateway';
import { WORKSPACE_TOOLS, executeTool, toolProgressLabel } from './tools';
import { VoiceSession } from './voice';
import { VadSession } from './vad';
import { TtsSession } from './tts';
import { transcribe } from './whisper';
import { SkillRegistry, Skill } from './skills';
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

	// Hard tool-usage discipline. The agent's identity and persona live in OpenClaw config
	// (agents.list[].identity); the boot files are disabled via contextInjection: "never".
	messages.push({
		role: 'system',
		content: [
			`You are running inside the user's VS Code editor with access to workspace_* tools (list_files, read_file, find_files, grep).`,
			``,
			`MANDATORY RULES — no exceptions:`,
			`1. If the user mentions a file path (e.g. docs/foo.md, src/foo.ts), you MUST call workspace_read_file BEFORE writing anything. Never say "I cannot access" or "based on the summary you provided" — there is no summary. You either call the tool, or you report a tool error verbatim.`,
			`2. If the user asks about "the code", "the project", "the files", you MUST call workspace_list_files or workspace_grep first. Never guess project structure.`,
			`3. NEVER cite content (filenames, code, quotes) that you have not received in a tool result. If a tool result is marked truncated, say so explicitly and offer to fetch more.`,
			`4. If a tool call returns an error, surface the error to the user — do not fabricate a fallback.`,
			``,
			`Always reply in the same language the user wrote in. Code and code comments stay in their original language.`,
		].join('\n'),
	});

	// Check if the prompt invokes a specific skill by name
	const invocation = skillRegistry.matchInvokedSkill(request.prompt);

	// Inject command-specific system prompt
	if (request.command && COMMAND_PROMPTS[request.command]) {
		messages.push({ role: 'system', content: COMMAND_PROMPTS[request.command] });
	}

	if (invocation) {
		// Invoke mode: the matched skill is the sole system prompt
		chatLog.debug(`Skill invoked: ${invocation.skill.name}`);
		messages.push({ role: 'system', content: `## Skill: ${invocation.skill.name}\n${invocation.skill.systemPrompt}` });
	} else {
		// Passive mode: inject all enabled passive skill prompts
		const activeSkills = skillRegistry.passiveSkills;
		if (activeSkills.length > 0) {
			const skillBlock = activeSkills
				.map(s => `## Skill: ${s.name}\n${s.systemPrompt}`)
				.join('\n\n');
			messages.push({ role: 'system', content: `Active skills:\n\n${skillBlock}` });
		}
	}

	// Add a SLIM hint about the active editor — the LLM can use workspace_read_file
	// to fetch full content on demand. We only inject explicit selections (small, intentional).
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const doc = editor.document;
		const selection = editor.selection;
		const relPath = vscode.workspace.asRelativePath(doc.uri);
		if (!selection.isEmpty) {
			const selectedText = doc.getText(selection);
			const capped = selectedText.length > 4000 ? selectedText.slice(0, 4000) + '\n…(truncated)' : selectedText;
			messages.push({
				role: 'system',
				content:
					`Active editor selection — file: ${relPath} (${doc.languageId}), ` +
					`lines ${selection.start.line + 1}-${selection.end.line + 1}:\n\`\`\`\n${capped}\n\`\`\``,
			});
		} else {
			messages.push({
				role: 'system',
				content:
					`Active editor: ${relPath} (${doc.languageId}). ` +
					`Use workspace_read_file to fetch its content if relevant.`,
			});
		}
	}

	// When TTS is on, ask the LLM to include a spoken summary
	if (ttsEnabled) {
		messages.push({ role: 'system', content: 'The user has text-to-speech enabled. At the END of your response, add a concise 1-2 sentence spoken summary inside <spoken>...</spoken> tags. This summary should be natural French speech — no code, no JSON, no markdown. If the answer is already short and natural, just repeat it inside the tag.' });
	}

	const userContent = invocation
		? (invocation.remainder || 'Start')
		: request.prompt || (request.command && COMMAND_PROMPTS[request.command]
			? `Please ${request.command} the provided code.`
			: 'Hello');
	messages.push({ role: 'user', content: userContent });

	stream.progress('Connecting to OpenClaw gateway…');

	const adapter: GatewayAdapter = new OpenClawAdapter(gatewayUrl, gatewayToken || undefined);
	const abortController = new AbortController();
	token.onCancellationRequested(() => abortController.abort());

	let fullResponse = '';
	const MAX_TURNS = 8;
	const recentCalls: string[] = []; // signatures of last tool calls to detect loops

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		if (abortController.signal.aborted) { break; }

		let errorBubbled: string | undefined;
		const result = await adapter.streamChat(messages, abortController.signal, {
			onToolCall(tool) {
				// Progress is emitted from the execute loop below — keep this silent
				// to avoid duplicate "Listing files…" messages.
				chatLog.debug(`Tool call (turn ${turn}): ${tool.name}`);
			},
			onChunk(text) {
				stream.markdown(text);
				fullResponse += text;
			},
			onDone() { /* loop continues based on result */ },
			onError(err) {
				errorBubbled = err;
			},
		}, {
			tools: WORKSPACE_TOOLS,
			toolChoice: 'auto',
		});

		if (errorBubbled) {
			if (errorBubbled !== 'Cancelled') {
				stream.markdown(`\n\n⚠️ **Gateway error** : ${errorBubbled}`);
			}
			break;
		}

		if (result.finishReason !== 'tool_calls' || result.toolCalls.length === 0) {
			chatLog.debug(`Turn ${turn} done: finish=${result.finishReason}`);
			break;
		}

		// Append the assistant tool-call turn and execute each tool locally.
		messages.push({
			role: 'assistant',
			content: result.assistantContent,
			tool_calls: result.toolCalls,
		});

		for (const call of result.toolCalls) {
			const signature = `${call.name}::${call.arguments}`;
			const repeatCount = recentCalls.filter(s => s === signature).length;
			recentCalls.push(signature);

			stream.progress(`${toolProgressLabel(call.name)}…`);
			chatLog.info(`Executing ${call.name}(${call.arguments.slice(0, 200)})`);
			const toolResult = await executeTool(call.name, call.arguments);
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: toolResult,
			});

			// Loop guard: if the LLM has called the same tool with identical args
			// 2+ times, nudge it to stop and answer with what it has.
			if (repeatCount >= 1) {
				chatLog.info(`Loop detected on ${call.name} — injecting nudge`);
				messages.push({
					role: 'system',
					content: `You have already called ${call.name} with these exact arguments. Do not repeat the same call. Use the results you already have to answer the user now, in natural language. If results are insufficient, try a DIFFERENT tool or DIFFERENT arguments — never the same call twice.`,
				});
			}
		}
	}

	if (ttsEnabled && fullResponse.trim()) {
		const spokenMatch = fullResponse.match(/<spoken>([\s\S]*?)<\/spoken>/);
		const toSpeak = spokenMatch ? spokenMatch[1].trim() : '';
		if (toSpeak) {
			tts.speak(toSpeak);
		}
	}
};

export function deactivate() {}
