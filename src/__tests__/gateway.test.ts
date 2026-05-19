import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../logger';
import { OpenClawAdapter } from '../gateway';

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			if (index < chunks.length) {
				controller.enqueue(encoder.encode(chunks[index]));
				index++;
			} else {
				controller.close();
			}
		}
	});
}

describe('OpenClawAdapter', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		Logger.init();
	});

	it('streams SSE chunks and calls onChunk/onDone', async () => {
		const sseData = [
			'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
			'data: [DONE]\n\n',
		];

		const mockResponse = {
			ok: true,
			status: 200,
			statusText: 'OK',
			body: makeSSEStream(sseData),
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const adapter = new OpenClawAdapter('http://localhost:18789');
		const chunks: string[] = [];
		let done = false;
		let error: string | null = null;

		await adapter.streamChat(
			[{ role: 'user', content: 'hi' }],
			undefined,
			{
				onChunk: (text) => chunks.push(text),
				onDone: () => { done = true; },
				onError: (err) => { error = err; },
			}
		);

		expect(chunks).toEqual(['Hello', ' world']);
		expect(done).toBe(true);
		expect(error).toBeNull();
	});

	it('handles HTTP error responses', async () => {
		const mockResponse = {
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			text: async () => 'invalid token',
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const adapter = new OpenClawAdapter('http://localhost:18789', 'bad-token');
		let error: string | null = null;

		await adapter.streamChat(
			[{ role: 'user', content: 'hi' }],
			undefined,
			{
				onChunk: () => {},
				onDone: () => {},
				onError: (err) => { error = err; },
			}
		);

		expect(error).toContain('HTTP 401');
	});

	it('handles connection errors', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

		const adapter = new OpenClawAdapter('http://localhost:18789');
		let error: string | null = null;

		await adapter.streamChat(
			[{ role: 'user', content: 'hi' }],
			undefined,
			{
				onChunk: () => {},
				onDone: () => {},
				onError: (err) => { error = err; },
			}
		);

		expect(error).toContain('Connection error');
	});

	it('handles abort signal', async () => {
		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

		const adapter = new OpenClawAdapter('http://localhost:18789');
		let error: string | null = null;

		await adapter.streamChat(
			[{ role: 'user', content: 'hi' }],
			undefined,
			{
				onChunk: () => {},
				onDone: () => {},
				onError: (err) => { error = err; },
			}
		);

		expect(error).toBe('Cancelled');
	});

	it('handles malformed SSE JSON gracefully', async () => {
		const sseData = [
			'data: not-json\n\n',
			'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
			'data: [DONE]\n\n',
		];

		const mockResponse = {
			ok: true,
			status: 200,
			statusText: 'OK',
			body: makeSSEStream(sseData),
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const adapter = new OpenClawAdapter('http://localhost:18789');
		const chunks: string[] = [];
		let done = false;

		await adapter.streamChat(
			[{ role: 'user', content: 'hi' }],
			undefined,
			{
				onChunk: (text) => chunks.push(text),
				onDone: () => { done = true; },
				onError: () => {},
			}
		);

		expect(chunks).toEqual(['ok']);
		expect(done).toBe(true);
	});

	it('sends Authorization header when token provided', async () => {
		const sseData = ['data: [DONE]\n\n'];
		const mockResponse = {
			ok: true,
			status: 200,
			statusText: 'OK',
			body: makeSSEStream(sseData),
		};
		const fetchMock = vi.fn().mockResolvedValue(mockResponse);
		vi.stubGlobal('fetch', fetchMock);

		const adapter = new OpenClawAdapter('http://localhost:18789', 'my-token');
		await adapter.streamChat(
			[{ role: 'user', content: 'hi' }],
			undefined,
			{ onChunk: () => {}, onDone: () => {}, onError: () => {} }
		);

		const callArgs = fetchMock.mock.calls[0];
		expect(callArgs[1].headers['Authorization']).toBe('Bearer my-token');
	});
});
