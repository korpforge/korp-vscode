import * as vscode from 'vscode';

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
	_token
) => {
	stream.markdown(`👋 **Korp** reçoit : "${request.prompt}"\n\nL'extension est active — le backend LLM arrive bientôt.`);
};

export function deactivate() {}
