import {
	ChatMessage,
	GatewayAdapter,
	StreamCallbacks,
	StreamOptions,
	StreamResult,
	ToolCall,
} from './adapter';
import { Logger } from './logger';

const gwLog = {
	info: (msg: string) => Logger.channel.info(`[gateway] ${msg}`),
	debug: (msg: string) => Logger.channel.debug(`[gateway] ${msg}`),
	warn: (msg: string) => Logger.channel.warn(`[gateway] ${msg}`),
	error: (msg: string) => Logger.channel.error(`[gateway] ${msg}`),
};

const DEFAULT_MODEL = 'openclaw/vscode';

export class OpenClawAdapter implements GatewayAdapter {
	constructor(
		private readonly baseUrl: string,
		private readonly token?: string,
	) {}

	async streamChat(
		messages: ChatMessage[],
		signal: AbortSignal | undefined,
		callbacks: StreamCallbacks,
		options?: StreamOptions,
	): Promise<StreamResult> {
		const endpoint = `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this.token) {
			headers['Authorization'] = `Bearer ${this.token}`;
		}

		const bodyObj: Record<string, unknown> = {
			model: options?.model ?? DEFAULT_MODEL,
			messages,
			stream: true,
		};
		if (options?.tools && options.tools.length > 0) {
			bodyObj.tools = options.tools;
			bodyObj.tool_choice = options.toolChoice ?? 'auto';
		}

		const body = JSON.stringify(bodyObj);
		gwLog.info(
			`POST ${endpoint} model=${bodyObj.model} msgs=${messages.length} tools=${options?.tools?.length ?? 0}`,
		);

		let response: Response;
		try {
			response = await fetch(endpoint, { method: 'POST', headers, body, signal });
		} catch (err: any) {
			if (err.name === 'AbortError') {
				gwLog.info('Request aborted by user');
				callbacks.onError('Cancelled');
				return { finishReason: 'cancelled', toolCalls: [], assistantContent: '' };
			}
			gwLog.error(`Connection error: ${err.message}`);
			callbacks.onError(`Connection error: ${err.message}`);
			return { finishReason: 'error', toolCalls: [], assistantContent: '', errorMessage: err.message };
		}

		gwLog.info(`Response: HTTP ${response.status} ${response.statusText}`);

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			gwLog.error(`HTTP error: ${response.status} — ${text || response.statusText}`);
			callbacks.onError(`HTTP ${response.status}: ${text || response.statusText}`);
			return {
				finishReason: 'error',
				toolCalls: [],
				assistantContent: '',
				errorMessage: text || response.statusText,
			};
		}

		const reader = response.body?.getReader();
		if (!reader) {
			gwLog.error('No response body');
			callbacks.onError('No response body');
			return { finishReason: 'error', toolCalls: [], assistantContent: '' };
		}

		gwLog.info('SSE stream opened');
		const decoder = new TextDecoder();
		let buffer = '';
		let chunkCount = 0;
		let assistantContent = '';
		let finishReason: StreamResult['finishReason'] = 'unknown';

		// Tool calls accumulate by index; each delta may carry partial id/name/arguments fragments.
		const pendingByIndex = new Map<number, { id: string; name: string; arguments: string }>();
		const emittedNames = new Set<number>();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					gwLog.info(`Stream ended (reader done). ${chunkCount} content chunks.`);
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(':')) { continue; }
					if (!trimmed.startsWith('data: ')) { continue; }

					const payload = trimmed.slice(6);
					if (payload === '[DONE]') {
						gwLog.info(`SSE [DONE] after ${chunkCount} chunks, finish=${finishReason}, toolCalls=${pendingByIndex.size}`);
						const toolCalls = collectToolCalls(pendingByIndex);
						if (toolCalls.length > 0 && finishReason === 'unknown') {
							finishReason = 'tool_calls';
						}
						if (finishReason === 'unknown') {
							finishReason = 'stop';
						}
						callbacks.onDone();
						return { finishReason, toolCalls, assistantContent };
					}

					try {
						const chunk = JSON.parse(payload);
						const choice = chunk.choices?.[0];
						const delta = choice?.delta;

						if (delta?.tool_calls) {
							for (const tc of delta.tool_calls) {
								const idx = tc.index ?? 0;
								let entry = pendingByIndex.get(idx);
								if (!entry) {
									entry = { id: '', name: '', arguments: '' };
									pendingByIndex.set(idx, entry);
								}
								if (tc.id) { entry.id = tc.id; }
								if (tc.function?.name) { entry.name += tc.function.name; }
								if (tc.function?.arguments) { entry.arguments += tc.function.arguments; }
								if (entry.name && !emittedNames.has(idx) && callbacks.onToolCall) {
									emittedNames.add(idx);
									callbacks.onToolCall({ name: entry.name, arguments: '' });
								}
							}
						}

						const content = delta?.content;
						if (typeof content === 'string' && content.length > 0) {
							chunkCount++;
							assistantContent += content;
							callbacks.onChunk(content);
						}

						if (choice?.finish_reason) {
							finishReason = choice.finish_reason as StreamResult['finishReason'];
						}
					} catch {
						gwLog.warn(`Malformed SSE JSON: ${payload.slice(0, 100)}`);
					}
				}
			}

			const toolCalls = collectToolCalls(pendingByIndex);
			if (toolCalls.length > 0 && finishReason === 'unknown') {
				finishReason = 'tool_calls';
			}
			if (finishReason === 'unknown') {
				finishReason = 'stop';
			}
			callbacks.onDone();
			return { finishReason, toolCalls, assistantContent };
		} catch (err: any) {
			if (err.name === 'AbortError') {
				gwLog.info('Stream aborted by user');
				callbacks.onError('Cancelled');
				return { finishReason: 'cancelled', toolCalls: [], assistantContent };
			}
			gwLog.error(`Stream error: ${err.message}`);
			callbacks.onError(`Stream error: ${err.message}`);
			return { finishReason: 'error', toolCalls: [], assistantContent, errorMessage: err.message };
		}
	}
}

function collectToolCalls(
	map: Map<number, { id: string; name: string; arguments: string }>,
): ToolCall[] {
	const out: ToolCall[] = [];
	for (const [, v] of map) {
		if (!v.name) { continue; }
		out.push({
			id: v.id || cryptoRandomId(),
			name: v.name,
			arguments: v.arguments || '{}',
		});
	}
	return out;
}

function cryptoRandomId(): string {
	return 'tc_' + Math.random().toString(36).slice(2, 12);
}
