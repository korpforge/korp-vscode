# Changelog

All notable changes to the **Korp** VS Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Agentic workspace tools** — `@korp` now uses a client-side tool protocol to inspect the workspace on demand (`workspace_list_files`, `workspace_read_file`, `workspace_find_files`, `workspace_grep`). The LLM can call tools autonomously in multi-turn loops (capped at 8 turns), with a loop-guard that detects identical repeated calls.
- **Multi-source skill registry** with `korp.skillSources` setting. Supports three formats: `flat` (single `.md` per skill), `directory` (folder with `SKILL.md`), `proxy` (`.agent.md` references). Built-in scans of `.agents/skills/`, `.github/agents/`, `.korp/skills/`, and `~/.korp/skills/`.
- **Invoke-mode skills** — skills declared with `mode: invoke` are activated on-demand when the user types the skill trigger as a prefix to their prompt.
- **Forge subagents** — slash commands `/architect`, `/coder`, `/reviewer`, `/security`, `/tester`, `/docwriter`, `/deployer` now route to dedicated OpenClaw subagents (`openclaw/<agentId>`), each with its own identity and tool set.
- **Profile-B safety pre-check** — before spawning a write-capable subagent (`coder`, `tester`, `docwriter`), the extension runs `git status --porcelain` on the workspace root and refuses if the tree is dirty, to avoid races with the agent's PR. No-op (with a warning) when no workspace folder or no git repo is detected.

### Changed

- Slimmed baseline system prompt — Korp identity now lives in the OpenClaw gateway config (`agents.list[].identity`) rather than being injected by the extension on every turn, saving tokens.
- Active editor context is no longer dumped wholesale; only explicit selections (capped at 4 KB) are inlined. The LLM fetches files on demand via `workspace_read_file`.
- `OpenClawAdapter.streamChat()` now accepts `StreamOptions` with `tools` and `toolChoice`, and returns a `StreamResult` exposing `finishReason`, `toolCalls`, and `assistantContent` for agentic loop control.

### Fixed

- Hardened tool-usage discipline in the agentic loop: clearer truncation signals when tool output is capped, stricter guidance to prevent redundant calls.

## [0.0.3] — 2026-05-19

### Added

- Publish to **Open VSX** registry on tag.
- **MIT License**.
- **CI/CD** — GitHub Actions for build, lint, test, and publish-on-tag.
- **Onboarding wizard** on first activation (gateway URL, token, voice, TTS).
- **Structured logger** with scoped channels and toggleable debug level.
- **Skill registry** with TreeView panel and auto-detection.
- **Unit tests** (vitest) — 82% statement coverage.

### Changed

- README rewritten as a marketplace detail page.

## [0.0.2] — Earlier

### Added

- Initial public preview of `@korp` Chat Participant.
- Voice input (Push-to-Talk, VAD) via local Whisper sidecar.
- Text-to-speech via local Piper voice model.
- Slash commands: `/explain`, `/fix`, `/test`, `/docs`.

[Unreleased]: https://github.com/korpforge/korpforge/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/korpforge/korpforge/releases/tag/v0.0.3
