import * as vscode from 'vscode';
import { basename } from 'path';

export async function transcribe(wavBuffer: Buffer, whisperUrl: string): Promise<string> {
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
		`json` +
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
	// whisper.cpp server returns { text: "..." }
	const raw = (json.text ?? '').trim();

	// Filter Whisper hallucinations (silence, music, applause, etc.)
	if (!raw || /^\[.*\]$/.test(raw) || /^\(.*\)$/.test(raw)) {
		return '';
	}

	return raw;
}
