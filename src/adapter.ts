export interface ToolCall {
	id: string;
	name: string;
	arguments: string; // JSON string
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_calls?: ToolCall[];        // assistant turn that calls tools
	tool_call_id?: string;          // tool turn replying to a specific call
}

export interface ToolDef {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface ToolCallInfo {
	name: string;
	arguments: string;
}

export interface StreamCallbacks {
	onChunk: (text: string) => void;
	onToolCall?: (tool: ToolCallInfo) => void;
	onDone: () => void;
	onError: (err: string) => void;
}

export interface StreamResult {
	finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled' | 'unknown';
	toolCalls: ToolCall[];          // empty unless finishReason === 'tool_calls'
	assistantContent: string;       // accumulated content (may coexist with tool_calls)
	errorMessage?: string;
}

export interface StreamOptions {
	model?: string;
	tools?: ToolDef[];
	toolChoice?: 'auto' | 'none';
}

export interface GatewayAdapter {
	streamChat(
		messages: ChatMessage[],
		signal: AbortSignal | undefined,
		callbacks: StreamCallbacks,
		options?: StreamOptions
	): Promise<StreamResult>;
}
