/**
 * Pure helpers for parsing prompt syntax — no VS Code API dependencies,
 * so they can be unit-tested in isolation.
 */

/**
 * Parses a `<owner>/<repo>#<N>` reference, optionally surrounded by extra prompt text.
 * Returns null if no valid reference is found.
 *
 * Examples accepted:
 *   "korpforge/agent-mcp#4"
 *   "document korpforge/agent-mcp#4 please"
 *   "--source-pr 4 repo=korpforge/agent-mcp" (long form, also accepted)
 */
export function parseSourcePrRef(prompt: string): { owner: string; repo: string; source_pr: number } | null {
	// Short form: owner/repo#N
	const short = prompt.match(/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)/);
	if (short) {
		const n = parseInt(short[3], 10);
		if (Number.isInteger(n) && n > 0) {
			return { owner: short[1], repo: short[2], source_pr: n };
		}
	}
	// Long form: --source-pr N + repo=owner/repo
	const long = prompt.match(/--source-pr\s+(\d+)/);
	const repoLong = prompt.match(/repo[=:\s]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
	if (long && repoLong) {
		const n = parseInt(long[1], 10);
		if (Number.isInteger(n) && n > 0) {
			return { owner: repoLong[1], repo: repoLong[2], source_pr: n };
		}
	}
	return null;
}
