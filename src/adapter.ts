export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface StreamCallbacks {
	onChunk: (text: string) => void;
	onDone: () => void;
	onError: (err: string) => void;
}

export interface GatewayAdapter {
	streamChat(messages: ChatMessage[], signal: AbortSignal | undefined, callbacks: StreamCallbacks): Promise<void>;
}
