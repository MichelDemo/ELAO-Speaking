# Graph Report - .  (2026-06-17)

## Corpus Check
- Corpus is ~22,005 words - fits in a single context window. You may not need a graph.

## Summary
- 221 nodes · 292 edges · 16 communities (12 shown, 4 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.84)
- Token cost: 143,806 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Chat, TTS & CEFR Prompts|Chat, TTS & CEFR Prompts]]
- [[_COMMUNITY_Main UI & CEFR Display|Main UI & CEFR Display]]
- [[_COMMUNITY_Azure STT & Pronunciation Scoring|Azure STT & Pronunciation Scoring]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_LiveAvatar Session & Turn Handling|LiveAvatar Session & Turn Handling]]
- [[_COMMUNITY_Whisper STT Backend|Whisper STT Backend]]
- [[_COMMUNITY_Deepgram STT Backend|Deepgram STT Backend]]
- [[_COMMUNITY_3D Avatar Rendering|3D Avatar Rendering]]
- [[_COMMUNITY_Streaming Audio Playback|Streaming Audio Playback]]
- [[_COMMUNITY_App Config & Orchestration|App Config & Orchestration]]
- [[_COMMUNITY_WAV Audio Conversion|WAV Audio Conversion]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_Root Layout (detached)|Root Layout (detached)]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `AzureSTT` - 12 edges
3. `DeepgramSTT` - 12 edges
4. `StreamingAudioPlayer` - 11 edges
5. `WhisperSTT` - 10 edges
6. `POST()` - 7 edges
7. `Avatar()` - 7 edges
8. `blobToWav16kMono()` - 7 edges
9. `SessionRecorder` - 7 edges
10. `buildEvaluationUserMessage()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `CEFR Conversation POC README` --references--> `Home (main page orchestrator)`  [EXTRACTED]
  README.md → app/page.tsx
- `CEFR Conversation POC README` --references--> `POST()`  [EXTRACTED]
  README.md → app/api/chat/route.ts
- `CEFR Conversation POC README` --references--> `POST()`  [EXTRACTED]
  README.md → app/api/evaluate/route.ts
- `StreamingAudioPlayer` --shares_data_with--> `Avatar()`  [INFERRED]
  lib/audio-player.ts → components/Avatar.tsx
- `nextConfig` --rationale_for--> `Home (main page orchestrator)`  [INFERRED]
  next.config.js → app/page.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Server-side API key token issuance routes** — deepgram_token_route_get, speech_token_route_get, liveavatar_session_route_post [INFERRED 0.75]
- **Ensemble pronunciation assessment flow** — pronunciation_route_post, pronunciation_route_deepgramverbatim, pronunciation_route_azureacoustic, pronunciation_route_judge [EXTRACTED 0.95]
- **User turn capture, scoring, and avatar reply flow** — page_startsession, page_handleuserturn, page_callpronunciationapi, page_processbuffered, chat_route_post [INFERRED 0.85]
- **Interchangeable speech-to-text backends** — lib_azure_stt_azurestt, lib_deepgram_stt_deepgramstt, lib_whisper_stt_whisperstt [INFERRED 0.90]
- **Avatar render fallback chain (GLB/FBX/SVG)** — components_avatar_glbmodel, components_avatar_fbxmodel, components_avatar_svgface [INFERRED 0.85]
- **Session audio capture and recording flow** — lib_audio_player_streamingaudioplayer, lib_session_recorder_sessionrecorder, lib_deepgram_stt_deepgramstt [INFERRED 0.75]

## Communities (16 total, 4 thin omitted)

### Community 0 - "Chat, TTS & CEFR Prompts"
Cohesion: 0.11
Nodes (26): anthropic, buildSSML(), ChatRequest, escapeXml(), Parallel TTS latency strategy, POST(), startTTS(), VOICE_PROFILE (+18 more)

### Community 1 - "Main UI & CEFR Display"
Cohesion: 0.09
Nodes (19): Avatar, AzureAvg, Bar(), btn(), CefrPanel(), CefrResult, CONFIDENCE_COLOR, Home() (+11 more)

### Community 2 - "Azure STT & Pronunciation Scoring"
Cohesion: 0.11
Nodes (20): AzureSTT, CONTINUATION_WORDS, RecognizerHandle, SttCallbacks, WordScore, discreteWordConfidence(), wordAccuracy(), UserWords (coloured transcript) (+12 more)

### Community 3 - "Package Dependencies"
Cohesion: 0.08
Nodes (25): dependencies, @anthropic-ai/sdk, buffer, livekit-client, microsoft-cognitiveservices-speech-sdk, next, openai, react (+17 more)

### Community 4 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 5 - "LiveAvatar Session & Turn Handling"
Cohesion: 0.11
Nodes (15): GET(), POST(), Action, HEYGEN_ENDPOINTS, POST(), TaskRequest, Fidelity-first assessment mic constraints, Buffered turn queue (barge-in handling) (+7 more)

### Community 6 - "Whisper STT Backend"
Cohesion: 0.14
Nodes (10): PronunciationResult STT contract, PronunciationResult, encodeWAV(), PronunciationResult, SttCallbacks, WhisperResponse, WhisperSegment, WhisperSTT (+2 more)

### Community 7 - "Deepgram STT Backend"
Cohesion: 0.18
Nodes (5): DeepgramSTT, DgWord, PronunciationResult, SttCallbacks, WordScore

### Community 8 - "3D Avatar Rendering"
Cohesion: 0.29
Nodes (7): Avatar(), AvatarProps, BS, FBXModel(), GLBModel(), ModelErrorBoundary, SVGFace()

### Community 10 - "App Config & Orchestration"
Cohesion: 0.29
Nodes (6): nextConfig, CefrPanel (result display), Home (main page orchestrator), runEvaluation (CEFR trigger), saveSession (Supabase persist), scoreToLevel (CEFR band mapping)

### Community 11 - "WAV Audio Conversion"
Cohesion: 0.70
Nodes (4): blobToWav16kMono(), getDecodeContext(), normalize(), trimSilence()

## Knowledge Gaps
- **85 isolated node(s):** `anthropic`, `anthropic`, `SttContext`, `Action`, `TaskRequest` (+80 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AzureSTT` connect `Azure STT & Pronunciation Scoring` to `Chat, TTS & CEFR Prompts`, `Main UI & CEFR Display`, `Whisper STT Backend`, `Deepgram STT Backend`, `WAV Audio Conversion`?**
  _High betweenness centrality (0.327) - this node is a cross-community bridge._
- **Why does `buildEvaluationUserMessage()` connect `Chat, TTS & CEFR Prompts` to `Azure STT & Pronunciation Scoring`?**
  _High betweenness centrality (0.192) - this node is a cross-community bridge._
- **Why does `StreamingAudioPlayer` connect `Streaming Audio Playback` to `3D Avatar Rendering`, `Main UI & CEFR Display`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `AzureSTT` (e.g. with `blobToWav16kMono()` and `buildEvaluationUserMessage()`) actually correct?**
  _`AzureSTT` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `DeepgramSTT` (e.g. with `AzureSTT` and `PronunciationResult STT contract`) actually correct?**
  _`DeepgramSTT` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `anthropic`, `anthropic`, `SttContext` to the rest of the system?**
  _88 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Chat, TTS & CEFR Prompts` be split into smaller, more focused modules?**
  _Cohesion score 0.1053763440860215 - nodes in this community are weakly interconnected._