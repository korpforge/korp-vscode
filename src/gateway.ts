import { ChatMessage, GatewayAdapter, StreamCallbacks } from './adapter';
import { Logger } from './logger';

const gwLog = {
	info: (msg: string) => Logger.channel.info(`[gateway] ${msg}`),
	debug: (msg: string) => Logger.channel.debug(`[gateway] ${msg}`),
	warn: (msg: string) => Logger.channel.warn(`[gateway] ${msg}`),
	error: (msg: string) => Logger.channel.error(`[gateway] ${msg}`),
};

export class OpenClawAdapter implements GatewayAdapter {
	constructor(
		private readonly baseUrl: string,
		private readonly token?: string,
	) {}

	async streamChat(messages: ChatMessage[], signal: AbortSignal | undefined, callbacks: StreamCallbacks): Promise<void> {
		const endpoint = `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this.token) {
			headers['Authorization'] = `Bearer ${this.token}`;
		}

		const body = JSON.stringify({
			model: 'openclaw/default',
			messages,
			stream: true,
		});

		gwLog.info(`POST ${endpoint} (${messages.length} messages, stream=true)`);

		let response: Response;
		try {
			response = await fetch(endpoint, {
				method: 'POST',
				headers,
				body,
				signal,
			});
		} catch (err: any) {
			if (err.name === 'AbortError') {
				gwLog.info('Request aborted by user');
				callbacks.onError('Cancelled');
			} else {
				gwLog.error(`Connection error: ${err.message}`);
				callbacks.onError(`Connection error: ${err.message}`);
			}
			return;
		}

		gwLog.info(`Response: HTTP ${response.status} ${response.statusText}`);

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			gwLog.error(`HTTP error: ${response.status} — ${text || response.statusText}`);
			callbacks.onError(`HTTP ${response.status}: ${text || response.statusText}`);
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			gwLog.error('No response body (reader is null)');
			callbacks.onError('No response body');
			return;
		}

		gwLog.info('SSE stream opened, waiting for chunks…');
		const decoder = new TextDecoder();
		let buffer = '';
		let chunkCount = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					gwLog.info(`Stream ended (reader done). ${chunkCount} content chunks received.`);
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(':')) { continue; }
					if (!trimmed.startsWith('data: ')) {
						gwLog.debug(`SSE non-data line: ${trimmed.slice(0, 120)}`);
						continue;
					}

					const payload = trimmed.slice(6);
					if (payload === '[DONE]') {
						gwLog.info(`SSE [DONE] after ${chunkCount} chunks.`);
						callbacks.onDone();
						return;
					}

					try {
						const chunk = JSON.parse(payload);
						const content = chunk.choices?.[0]?.delta?.content;
						if (content) {
							chunkCount++;
							callbacks.onChunk(content);
						}
					} catch {
						gwLog.warn(`Malformed SSE JSON: ${payload.slice(0, 100)}`);
					}
				}
			}
			callbacks.onDone();
		} catch (err: any) {
			if (err.name === 'AbortError') {
				gwLog.info('Stream aborted by user');
				callbacks.onError('Cancelled');
			} else {
				gwLog.error(`Stream error: ${err.message}`);
				callbacks.onError(`Stream error: ${err.message}`);
			}
		}
	}
}
