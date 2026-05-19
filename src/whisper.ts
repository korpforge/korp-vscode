import * as vscode from 'vscode';
import { basename } from 'path';

export interface TranscriptionResult {
	text: string;
	confidence: number; // 0-1
}

export async function transcribe(wavBuffer: Buffer, whisperUrl: string): Promise<TranscriptionResult | null> {
	const url = `${whisperUrl.replace(/\/$/, '')}/inference`;

	// Build multipart/form-data manually (no external dep)
	const boundary = `----KorpBoundary${Date.now()}`;
	const filename = 'recording.wav';

	const preamble = Buffer.from(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
		`Content-Type: audio/wav\r\n\r\n`
	);
	const middle = Buffer.from(
		`\r\n--${boundary}\r\n` +
		`Content-Disposition: form-data; name="response_format"\r\n\r\n` +
		`verbose_json` +
		`\r\n--${boundary}\r\n` +
		`Content-Disposition: form-data; name="temperature"\r\n\r\n` +
		`0` +
		`\r\n--${boundary}\r\n` +
		`Content-Disposition: form-data; name="prompt"\r\n\r\n` +
		`Korp, Korpforge, OpenClaw, VS Code, Forgejo, développeur, code, fichier, fonction, variable, commit, branche, pull request, déploiement, terminal, debug`
	);
	const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);

	const body = Buffer.concat([preamble, wavBuffer, middle, epilogue]);

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': `multipart/form-data; boundary=${boundary}`,
		},
		body,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Whisper HTTP ${response.status}: ${text || response.statusText}`);
	}

	const json: any = await response.json();
	const raw = (json.text ?? '').trim();

	// Filter Whisper hallucinations (silence, music, applause, etc.)
	if (!raw || /^\[.*\]$/.test(raw) || /^\(.*\)$/.test(raw)) {
		return null;
	}

	// Filter onomatopoeia / non-speech sounds (e.g. *tousse*, *rire*, *soupir*)
	if (/^\*[^*]+\*$/.test(raw)) {
		return null;
	}

	// Compute average word probability as confidence score
	let confidence = 1.0;
	const segments = json.segments ?? [];
	const allProbs: number[] = [];
	for (const seg of segments) {
		for (const w of seg.words ?? []) {
			if (typeof w.probability === 'number') {
				allProbs.push(w.probability);
			}
		}
	}
	if (allProbs.length > 0) {
		confidence = allProbs.reduce((a: number, b: number) => a + b, 0) / allProbs.length;
	}

	return { text: raw, confidence };
}
