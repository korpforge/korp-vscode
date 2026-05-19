import * as vscode from 'vscode';
import { ChatMessage, streamCompletion } from './gateway';

const DEFAULT_GATEWAY_URL = 'http://localhost:18789';
const SECRET_GW_KEY = 'korp.gatewayToken';

export function activate(context: vscode.ExtensionContext) {
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

	context.subscriptions.push(participant, setGwTokenCmd);
}

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

	const messages: ChatMessage[] = [];

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

	messages.push({ role: 'user', content: request.prompt });

	stream.progress('Connecting to OpenClaw gateway…');

	const abortController = new AbortController();
	token.onCancellationRequested(() => abortController.abort());

	return new Promise<void>((resolve) => {
		streamCompletion(messages, {
			url: gatewayUrl,
			gatewayToken: gatewayToken || undefined,
			signal: abortController.signal,
			onChunk(text) {
				stream.markdown(text);
			},
			onDone() {
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
