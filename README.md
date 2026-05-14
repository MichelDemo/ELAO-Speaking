# CEFR Conversation POC

POC d'évaluation du niveau CEFR (A1-C2) via conversation vocale avec avatar 3D réactif.

## Stack
- **Frontend** : Next.js 15 (App Router) + React 19
- **Avatar 3D** : Three.js + react-three-fiber + Ready Player Me
- **STT** : Deepgram Nova-3 (WebSocket streaming, FR + EN)
- **LLM conversation** : Claude Sonnet 4.5 (streaming)
- **TTS** : Deepgram Aura-2 (WebSocket streaming)
- **Évaluation CEFR** : Claude Sonnet 4.5 (analyse structurée à T+5min)

## Architecture

```
Browser (Next.js page)
  ├─ MediaRecorder → /api/stt-token → Deepgram WS (STT)
  ├─ Three.js avatar (RPM glTF + visemes from audio)
  └─ Audio player <— /api/chat (SSE: text + audio chunks base64)
                      └─ orchestre: Claude streaming → Deepgram Aura WS

  ├─ /api/evaluate (à T+5min) → Claude analyse transcript → score CEFR
```

## Sécurité de la clé Deepgram

La clé `DEEPGRAM_API_KEY` ne quitte JAMAIS le serveur.
- Le navigateur appelle `/api/stt-token` → reçoit un token éphémère (TTL 60s)
- Le TTS Aura est appelé côté serveur, l'audio est streamé au client via SSE

## Setup

```bash
# 1. Installer
pnpm install   # ou npm install

# 2. Variables d'environnement
cp .env.example .env.local
# Remplir DEEPGRAM_API_KEY (la nouvelle, pas celle qui a fuité !)
# et ANTHROPIC_API_KEY

# 3. Lancer
pnpm dev
```

Ouvrir http://localhost:3000

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `app/page.tsx` | UI + orchestration mic/avatar |
| `app/api/stt-token/route.ts` | Token Deepgram éphémère |
| `app/api/chat/route.ts` | Claude → Aura, stream SSE |
| `app/api/evaluate/route.ts` | Évaluation CEFR du transcript |
| `lib/deepgram-stt.ts` | Client STT navigateur |
| `lib/cefr-prompt.ts` | Prompt d'évaluation CEFR |
| `components/Avatar.tsx` | Avatar 3D RPM avec visemes |

## Roadmap après POC

- Lip-sync précis avec wawa-lipsync (analyse audio → visemes ARKit)
- Détection d'émotion dans la réponse Claude → blendshapes (sourire, surprise...)
- VAD (Voice Activity Detection) côté client pour couper l'avatar quand l'user parle
- Évaluation continue (pas juste à T+5min) avec score qui évolue
