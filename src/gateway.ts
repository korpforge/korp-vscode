import { ChatMessage, GatewayAdapter, StreamCallbacks } from './adapter';

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
				callbacks.onError('Cancelled');
			} else {
				callbacks.onError(`Connection error: ${err.message}`);
			}
			return;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			callbacks.onError(`HTTP ${response.status}: ${text || response.statusText}`);
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			callbacks.onError('No response body');
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) { break; }

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(':')) { continue; }
					if (!trimmed.startsWith('data: ')) { continue; }

					const payload = trimmed.slice(6);
					if (payload === '[DONE]') {
						callbacks.onDone();
						return;
					}

					try {
						const chunk = JSON.parse(payload);
						const content = chunk.choices?.[0]?.delta?.content;
						if (content) {
							callbacks.onChunk(content);
						}
					} catch {
						// skip malformed JSON lines
					}
				}
			}
			callbacks.onDone();
		} catch (err: any) {
			if (err.name === 'AbortError') {
				callbacks.onError('Cancelled');
			} else {
				callbacks.onError(`Stream error: ${err.message}`);
			}
		}
	}
}
