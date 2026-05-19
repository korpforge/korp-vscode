import { WebSocket } from 'ws';

export interface GatewayMessage {
	type: 'chunk' | 'done' | 'error';
	content?: string;
	error?: string;
}

export interface GatewayOptions {
	url: string;
	onChunk: (text: string) => void;
	onDone: () => void;
	onError: (err: string) => void;
	signal?: AbortSignal;
}

export function streamCompletion(prompt: string, opts: GatewayOptions): void {
	const ws = new WebSocket(opts.url);

	const cleanup = () => {
		if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
			ws.close();
		}
	};

	if (opts.signal) {
		opts.signal.addEventListener('abort', () => {
			cleanup();
			opts.onError('Cancelled');
		});
	}

	ws.on('open', () => {
		ws.send(JSON.stringify({ type: 'completion', prompt }));
	});

	ws.on('message', (data: Buffer) => {
		try {
			const msg: GatewayMessage = JSON.parse(data.toString());
			switch (msg.type) {
				case 'chunk':
					if (msg.content) {
						opts.onChunk(msg.content);
					}
					break;
				case 'done':
					opts.onDone();
					cleanup();
					break;
				case 'error':
					opts.onError(msg.error ?? 'Unknown gateway error');
					cleanup();
					break;
			}
		} catch {
			opts.onError('Invalid message from gateway');
			cleanup();
		}
	});

	ws.on('error', (err) => {
		opts.onError(`WebSocket error: ${err.message}`);
	});

	ws.on('close', () => {
		// noop — done/error already handled
	});
}
