import * as vscode from 'vscode';
import { streamCompletion } from './gateway';

const DEFAULT_GATEWAY_URL = 'ws://localhost:18789';

export function activate(context: vscode.ExtensionContext) {
	const participant = vscode.chat.createChatParticipant(
		'korpforge.korp',
		handler
	);
	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'korp-icon.png');

	context.subscriptions.push(participant);
}

const handler: vscode.ChatRequestHandler = async (
	request,
	_context,
	stream,
	token
) => {
	const config = vscode.workspace.getConfiguration('korp');
	const gatewayUrl = config.get<string>('gatewayUrl', DEFAULT_GATEWAY_URL);

	stream.progress('Connecting to OpenClaw gateway…');

	const abortController = new AbortController();
	token.onCancellationRequested(() => abortController.abort());

	return new Promise<void>((resolve, reject) => {
		streamCompletion(request.prompt, {
			url: gatewayUrl,
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
