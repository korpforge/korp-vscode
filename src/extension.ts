import * as vscode from 'vscode';
import { streamCompletion } from './gateway';

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

	stream.progress('Connecting to OpenClaw gateway…');

	const abortController = new AbortController();
	token.onCancellationRequested(() => abortController.abort());

	return new Promise<void>((resolve) => {
		streamCompletion(request.prompt, {
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
