import { describe, it, expect } from 'vitest';
import { parseSourcePrRef } from '../parsers';

describe('parseSourcePrRef', () => {
	it('parses the short form owner/repo#N', () => {
		expect(parseSourcePrRef('korpforge/agent-mcp#4')).toEqual({
			owner: 'korpforge',
			repo: 'agent-mcp',
			source_pr: 4,
		});
	});

	it('parses the short form embedded in a sentence', () => {
		expect(parseSourcePrRef('document korpforge/agent-mcp#42 please')).toEqual({
			owner: 'korpforge',
			repo: 'agent-mcp',
			source_pr: 42,
		});
	});

	it('parses the long form --source-pr N repo=owner/repo', () => {
		expect(parseSourcePrRef('--source-pr 7 repo=korpforge/vscode')).toEqual({
			owner: 'korpforge',
			repo: 'vscode',
			source_pr: 7,
		});
	});

	it('returns null when no reference is present', () => {
		expect(parseSourcePrRef('please document something')).toBeNull();
	});

	it('returns null when only --source-pr without repo', () => {
		expect(parseSourcePrRef('--source-pr 4')).toBeNull();
	});

	it('rejects zero and negative source_pr', () => {
		expect(parseSourcePrRef('korpforge/agent-mcp#0')).toBeNull();
	});

	it('accepts hyphenated repo and dotted names', () => {
		expect(parseSourcePrRef('foo.bar/my-repo_1#9')).toEqual({
			owner: 'foo.bar',
			repo: 'my-repo_1',
			source_pr: 9,
		});
	});
});
