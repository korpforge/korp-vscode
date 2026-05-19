# Korp — Extension VS Code

Assistant dev IA souverain. Chat Participant `@korp` connecté à une gateway OpenClaw.

## Prérequis

- VS Code ≥ 1.93
- Une gateway OpenClaw accessible (voir `../stack/`)
- **sox** (pour le mode voix push-to-talk)
- **whisper-cpp** (pour la transcription STT locale)

### Installation des dépendances système

#### macOS

```bash
brew install sox whisper-cpp
```

#### Linux (Debian/Ubuntu)

```bash
sudo apt install sox
# whisper-cpp : build from source ou utiliser faster-whisper-server en Docker
```

#### Windows

Utiliser WSL2 avec les instructions Linux, ou installer SoX depuis https://sox.sourceforge.net/

### Installation du modèle Whisper

```bash
mkdir -p ~/.korpforge/models
curl -L -o ~/.korpforge/models/ggml-base.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

Pour un modèle plus précis (recommandé pour le français) :
```bash
curl -L -o ~/.korpforge/models/ggml-small.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
```

### Lancer le serveur Whisper

#### macOS (Metal, natif)

```bash
whisper-server \
  --model ~/.korpforge/models/ggml-base.bin \
  --port 9500 \
  --language fr
```

#### Linux / Windows (Docker)

```bash
# CPU
docker run -d --name whisper \
  -p 9500:8000 \
  fedirz/faster-whisper-server:latest \
  --model-size base

# GPU NVIDIA
docker run -d --name whisper \
  --gpus all \
  -p 9500:8000 \
  fedirz/faster-whisper-server:latest-cuda \
  --model-size small
```

## Développement

```bash
npm install
npm run compile
# F5 dans VS Code pour lancer l'Extension Development Host
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `korp.gatewayUrl` | `http://localhost:18789` | URL de la gateway OpenClaw |
| `korp.whisperUrl` | `http://localhost:9500` | URL du sidecar Whisper STT |

## Commandes

| Commande | Raccourci | Description |
|----------|-----------|-------------|
| `Korp: Push to Talk` | `Cmd+Shift+K` | Démarrer/arrêter l'enregistrement vocal |
| `Korp: Set Gateway Token` | — | Configurer le token de la gateway |
| `Korp: Set LLM Token` | — | Configurer un token LLM (BYOK) |

## Slash Commands

| Commande | Description |
|----------|-------------|
| `@korp /explain` | Explique le code sélectionné ou le fichier actif |
| `@korp /fix` | Identifie et corrige les bugs |
| `@korp /test` | Génère des tests unitaires |
| `@korp /docs` | Génère la documentation |
