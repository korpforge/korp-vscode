# Korp — AI Coding Assistant (Sovereign)

> Chat Participant `@korp` for VS Code — powered by your own self-hosted LLM gateway.

![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.93-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

### 💬 Chat Participant `@korp`

Type `@korp` in the VS Code Chat panel to talk to your sovereign AI assistant. Context-aware: sends your active file, selection, and workspace skills automatically.

### 🛠️ Agentic Workspace Tools

`@korp` is **workspace-aware**: it doesn't guess file contents — it inspects your project on demand using a built-in tool protocol, the same way Copilot or Claude Code work, but routed through your sovereign gateway.

The LLM can call these tools autonomously, in multi-turn loops:

| Tool | Purpose |
|------|---------|
| `workspace_list_files` | List files in a directory |
| `workspace_read_file` | Read a file (capped at 8 KB by default) |
| `workspace_find_files` | Glob-match files by pattern |
| `workspace_grep` | Search file contents (literal or regex) |

**Examples:**

```
@korp Liste les fichiers TypeScript du projet
@korp Cherche les TODO dans le code
@korp Explique ce que fait src/extension.ts
```

Each tool call appears as a progress message in the chat. The agentic loop is capped at 8 turns and includes a loop-guard that nudges the LLM if it repeats an identical call. Tools run **client-side**, in the user's VS Code workspace — your code never leaves your machine unless the LLM asks for a specific snippet.

### 🎙️ Voice Input (Push-to-Talk & VAD)

Record your voice with a single keybinding (`Cmd+Shift+K`). Powered by a local Whisper STT sidecar — no audio leaves your machine.

- **Push-to-Talk**: hold to record, release to transcribe
- **Voice Activity Detection (VAD)**: auto-listen when VS Code has focus

### 🔊 Text-to-Speech (TTS)

Hear responses read aloud via a local Piper neural voice. Toggle with `Korp: Toggle TTS`.

### 🧩 Skills Panel

Extend `@korp` with markdown skill files. Drop `.md` files in `.korp/skills/` or `~/.korp/skills/` to inject custom system prompts.

- Auto-detected on workspace open
- Toggle skills on/off from the Activity Bar
- Live reload on file changes

#### Skill Modes

Skills support two modes via frontmatter:

| Mode | Behaviour |
|------|-----------|
| `passive` (default) | Injected as background context in every message |
| `invoke` | Activated on-demand when you type the skill name |

**Invoke mode** works like BMAD Method's skill invocation — type the skill trigger directly in your prompt:

```
@korp korp-help
@korp korp-help I just set up the stack, what's next?
```

The invoked skill becomes the sole system prompt for that request, enabling focused multi-step workflows.

Example `.korp/skills/korp-help.md`:

```markdown
---
name: korp-help
description: Intelligent Korpforge guide
trigger: korp-help
mode: invoke
---
You are the Korpforge guide. When invoked:
1. Inspect workspace state
2. Determine current progress
3. Recommend next steps
```

### 🚀 Onboarding Wizard

First launch walks you through:

1. Gateway URL configuration
2. Token setup (stored securely in OS keychain)
3. Voice/STT activation
4. TTS preferences

Re-run anytime with **Korp: Run Onboarding Wizard**.

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `@korp /explain` | Explain the selected code or active file |
| `@korp /fix` | Identify and fix bugs |
| `@korp /test` | Generate unit tests |
| `@korp /docs` | Generate documentation |

---

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| Korp: Push to Talk | `Cmd+Shift+K` | Start/stop voice recording |
| Korp: Toggle VAD | — | Enable/disable voice activity detection |
| Korp: Toggle TTS | — | Enable/disable text-to-speech |
| Korp: Stop Speaking | — | Interrupt current TTS playback |
| Korp: Set Gateway Token | — | Store gateway token securely |
| Korp: Run Onboarding Wizard | — | Re-run first-launch setup |
| Korp: Toggle Skill | — | Enable/disable a skill |
| Korp: Refresh Skills | — | Reload skill files |
| Korp: Toggle Log Level | — | Switch between debug/info |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `korp.gatewayUrl` | `http://localhost:18789` | OpenClaw gateway URL |
| `korp.whisperUrl` | `http://localhost:9500` | Whisper STT sidecar URL |
| `korp.ttsEnabled` | `false` | Enable TTS for responses |
| `korp.ttsModel` | `~/.korpforge/models/piper/fr_FR-siwis-medium.onnx` | Piper ONNX voice model |
| `korp.vadEnabled` | `false` | Enable voice activity detection |
| `korp.logLevel` | `info` | Output channel log level |
| `korp.skillSources` | `[]` | Additional skill source directories (see below) |

### `korp.skillSources`

Add custom skill directories beyond the built-in scan paths. Each entry specifies a `path` and a `format`:

| Format | Description |
|--------|-------------|
| `flat` | Single `.md` file per skill (frontmatter optional) |
| `directory` | Each subfolder contains a `SKILL.md` entry point |
| `proxy` | `.agent.md` files that reference another file via `LOAD` |

Example in `.vscode/settings.json`:

```jsonc
{
  "korp.skillSources": [
    { "path": "_bmad/skills", "format": "directory" },
    { "path": "/absolute/path/to/shared-skills", "format": "flat" }
  ]
}
```

Paths can be relative (resolved from workspace root) or absolute. Built-in sources scanned automatically:

1. `.agents/skills/` — flat + directory
2. `.github/agents/` — proxy
3. `.korp/skills/` — flat *(deprecated)*
4. `~/.korp/skills/` — flat (global)

---

## Requirements

- **VS Code ≥ 1.93**
- **OpenClaw gateway** running (self-hosted, see [stack/](https://github.com/korpforge/korp-openclaw))
- **sox** — for voice recording (`brew install sox` / `apt install sox`)
- **whisper-server** — local Whisper STT sidecar on port 9500
- **piper** *(optional)* — for TTS (`brew install piper` or build from source)

---

## Quick Start

1. Install the extension
2. The onboarding wizard launches automatically
3. Configure your gateway URL and token
4. Type `@korp hello!` in the Chat panel

---

## Architecture

```
┌─────────────────────────────────────────┐
│  VS Code                                │
│  ┌─────────┐  ┌──────┐  ┌───────────┐   │
│  │ @korp   │  │ Voice│  │  Skills   │   │
│  │ Chat    │  │ PTT  │  │  Panel    │   │
│  └────┬────┘  └──┬───┘  └─────┬─────┘   │
│       │          │            │         │
│       ▼          ▼            │         │
│  ┌─────────┐  ┌───────┐       │         │
│  │OpenClaw │  │Whisper│       │         │
│  │Gateway  │  │ STT   │       │         │
│  │(SSE)    │  │(local)│       │         │
│  └─────────┘  └───────┘       │         │
│       │                       │         │
│       ▼                       ▼         │
│  ┌─────────┐           .korp/skills/    │
│  │  LLM    │                            │
│  │(self-   │                            │
│  │ hosted) │                            │
│  └─────────┘                            │
└─────────────────────────────────────────┘
```

---

## Development

```bash
cd vscode/
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

Run tests:
```bash
npx vitest run
```

---

## License

MIT © [Korpforge](https://github.com/korpforge)
