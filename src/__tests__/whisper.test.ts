import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transcribe } from '../whisper';

describe('transcribe', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns text and confidence from valid response', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			json: async () => ({
				text: 'Bonjour le monde',
				segments: [{
					words: [
						{ word: 'Bonjour', probability: 0.95 },
						{ word: 'le', probability: 0.92 },
						{ word: 'monde', probability: 0.88 },
					]
				}]
			}),
		};

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const result = await transcribe(Buffer.from('fake-wav'), 'http://localhost:9500');
		expect(result).not.toBeNull();
		expect(result!.text).toBe('Bonjour le monde');
		expect(result!.confidence).toBeCloseTo(0.9167, 2);
	});

	it('filters hallucination patterns [...]', async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({ text: '[musique]', segments: [] }),
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const result = await transcribe(Buffer.from('wav'), 'http://localhost:9500');
		expect(result).toBeNull();
	});

	it('filters hallucination patterns (...)', async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({ text: '(applaudissements)', segments: [] }),
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const result = await transcribe(Buffer.from('wav'), 'http://localhost:9500');
		expect(result).toBeNull();
	});

	it('filters onomatopoeia *...*', async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({ text: '*tousse*', segments: [] }),
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const result = await transcribe(Buffer.from('wav'), 'http://localhost:9500');
		expect(result).toBeNull();
	});

	it('filters empty text', async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({ text: '  ', segments: [] }),
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const result = await transcribe(Buffer.from('wav'), 'http://localhost:9500');
		expect(result).toBeNull();
	});

	it('throws on HTTP error', async () => {
		const mockResponse = {
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			text: async () => 'server error',
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		await expect(transcribe(Buffer.from('wav'), 'http://localhost:9500'))
			.rejects.toThrow('Whisper HTTP 500');
	});

	it('defaults confidence to 1.0 if no word probabilities', async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({ text: 'hello', segments: [] }),
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

		const result = await transcribe(Buffer.from('wav'), 'http://localhost:9500');
		expect(result!.confidence).toBe(1.0);
	});
});
