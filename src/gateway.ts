export interface GatewayOptions {
	url: string;
	token?: string;
	gatewayToken?: string;
	onChunk: (text: string) => void;
	onDone: () => void;
	onError: (err: string) => void;
	signal?: AbortSignal;
}

export async function streamCompletion(prompt: string, opts: GatewayOptions): Promise<void> {
	const baseUrl = opts.url.replace(/\/$/, '');
	const endpoint = `${baseUrl}/v1/chat/completions`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (opts.gatewayToken) {
		headers['Authorization'] = `Bearer ${opts.gatewayToken}`;
	}

	const body = JSON.stringify({
		model: 'openclaw/default',
		messages: [{ role: 'user', content: prompt }],
		stream: true,
	});

	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body,
			signal: opts.signal,
		});
	} catch (err: any) {
		if (err.name === 'AbortError') {
			opts.onError('Cancelled');
		} else {
			opts.onError(`Connection error: ${err.message}`);
		}
		return;
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		opts.onError(`HTTP ${response.status}: ${text || response.statusText}`);
		return;
	}

	const reader = response.body?.getReader();
	if (!reader) {
		opts.onError('No response body');
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
					opts.onDone();
					return;
				}

				try {
					const chunk = JSON.parse(payload);
					const content = chunk.choices?.[0]?.delta?.content;
					if (content) {
						opts.onChunk(content);
					}
				} catch {
					// skip malformed JSON lines
				}
			}
		}
		opts.onDone();
	} catch (err: any) {
		if (err.name === 'AbortError') {
			opts.onError('Cancelled');
		} else {
			opts.onError(`Stream error: ${err.message}`);
		}
	}
}
