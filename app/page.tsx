"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AzureSTT, type PronunciationResult, type WordScore } from "@/lib/azure-stt";
import { StreamingAudioPlayer } from "@/lib/audio-player";
import type { LiveAvatarHandle } from "@/components/LiveAvatar";

const Avatar = dynamic(
  () => import("@/components/Avatar").then((m) => m.Avatar),
  { ssr: false }
);

const LiveAvatar = dynamic(
  () => import("@/components/LiveAvatar").then((m) => m.LiveAvatar),
  { ssr: false }
);

const USE_HEYGEN = process.env.NEXT_PUBLIC_HEYGEN_ENABLED === "true";

type Lang = "fr" | "en" | "nl-BE";
type Msg = {
  role: "user" | "assistant";
  content: string;
  pronunciation?: PronunciationResult; // only on user turns
};

interface CefrResult {
  level: string;
  globalScore: number;
  confidence: number;
  scores: Record<string, number>; // 0-100 per criterion
  evidence: {
    strengths: string[];
    weaknesses: string[];
    examples: { quote: string; observation: string }[];
  };
  recommendation: string;
}

// ─── CEFR scale (mirrors cefr-prompt.ts) ─────────────────────────────────────

function scoreToLevel(score: number): string {
  if (score <= 2) return "A0";
  if (score <= 5) return "A0 (25)";
  if (score <= 8) return "A0 (50)";
  if (score <= 11) return "A0 (75)";
  if (score <= 16) return "A1";
  if (score <= 20) return "A1 (25)";
  if (score <= 24) return "A1 (50)";
  if (score <= 28) return "A1 (75)";
  if (score <= 32) return "A2";
  if (score <= 36) return "A2 (25)";
  if (score <= 40) return "A2 (50)";
  if (score <= 44) return "A2 (75)";
  if (score <= 48) return "B1";
  if (score <= 52) return "B1 (25)";
  if (score <= 56) return "B1 (50)";
  if (score <= 60) return "B1 (75)";
  if (score <= 64) return "B2";
  if (score <= 68) return "B2 (25)";
  if (score <= 72) return "B2 (50)";
  if (score <= 76) return "B2 (75)";
  if (score <= 80) return "C1";
  if (score <= 84) return "C1 (25)";
  if (score <= 87) return "C1 (50)";
  if (score <= 90) return "C1 (75)";
  return "C2";
}

// ─── colour helpers ──────────────────────────────────────────────────────────

function wordColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#facc15";
  if (score >= 40) return "#fb923c";
  return "#f87171";
}

function scoreBarColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#facc15";
  return "#fb923c";
}

// ─── small reusable bar ───────────────────────────────────────────────────────

function Bar({
  label,
  value,
  max = 100,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 3 }}>
      <span style={{ width: 80, color: "#9ca3af", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: "rgba(0,0,0,0.35)", borderRadius: 3 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: scoreBarColor(pct),
            borderRadius: 3,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <span style={{ width: 28, textAlign: "right", color: "#e5e7eb" }}>{Math.round(value)}</span>
    </div>
  );
}

// ─── Azure live panel ─────────────────────────────────────────────────────────

interface AzureAvg {
  pronunciation: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  score: number;
  count: number;
}

function AzurePanel({ data }: { data: AzureAvg | null }) {
  return (
    <div
      style={{
        padding: 12,
        background: "#0f172a",
        border: "1px solid #1e3a5f",
        borderRadius: 8,
        minHeight: 120,
      }}
    >
      <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>
        QUALITÉ DE PRONONCIATION
      </div>
      {!data ? (
        <div style={{ color: "#4b5563", fontSize: 12 }}>En attente…</div>
      ) : (
        <>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, color: "#f1f5f9" }}>
            {data.score}<span style={{ fontSize: 16, color: "#4b5563" }}>/100</span>
          </div>
          <div style={{ fontSize: 10, color: "#4b5563", marginBottom: 8 }}>
            Score acoustique · {data.count} tour{data.count > 1 ? "s" : ""}
          </div>
          <Bar label="Prononciation" value={data.pronunciation} />
          <Bar label="Précision" value={data.accuracy} />
          <Bar label="Fluidité" value={data.fluency} />
          <Bar label="Complétude" value={data.completeness} />
          <div style={{ fontSize: 9, color: "#374151", marginTop: 4 }}>
            Mesure acoustique uniquement — pas de niveau CEFR
          </div>
        </>
      )}
    </div>
  );
}

// ─── Claude CEFR panel ────────────────────────────────────────────────────────

function CefrPanel({ result }: { result: CefrResult }) {
  return (
    <div
      style={{
        padding: 12,
        background: "linear-gradient(135deg, #1e3a8a 0%, #4f46e5 100%)",
        borderRadius: 8,
        minHeight: 120,
      }}
    >
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 700, letterSpacing: 1 }}>
        CLAUDE CEFR
      </div>
      <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1 }}>{result.level}</div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>
        Score {result.globalScore ?? "—"}/100 · Confiance {Math.round(result.confidence * 100)}%
      </div>
      {Object.entries(result.scores).map(([k, v]) => (
        <Bar key={k} label={k} value={Math.round(v)} />
      ))}
      {result.evidence?.strengths?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>Points forts</div>
          <ul style={{ margin: "3px 0", paddingLeft: 16, fontSize: 11 }}>
            {result.evidence.strengths.slice(0, 2).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Comparison table (shown when both results available) ─────────────────────

function ComparisonTable({ azure, cefr }: { azure: AzureAvg; cefr: CefrResult }) {
  const rows: { label: string; azureVal: number; cefrKey: string }[] = [
    { label: "Précision", azureVal: azure.accuracy, cefrKey: "accuracy" },
    { label: "Fluidité", azureVal: azure.fluency, cefrKey: "fluency" },
  ];

  return (
    <div
      style={{
        padding: "8px 12px",
        background: "#111827",
        border: "1px solid #374151",
        borderRadius: 8,
        fontSize: 11,
      }}
    >
      <div style={{ color: "#9ca3af", fontWeight: 700, marginBottom: 6, letterSpacing: 1, fontSize: 10 }}>
        ACOUSTIQUE vs CEFR
      </div>

      {/* Score rows */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#6b7280" }}>
            <th style={{ textAlign: "left", fontWeight: 400, paddingBottom: 4 }}>Critère</th>
            <th style={{ textAlign: "center", fontWeight: 400, paddingBottom: 4 }}>Azure</th>
            <th style={{ textAlign: "center", fontWeight: 400, paddingBottom: 4 }}>Claude</th>
            <th style={{ textAlign: "center", fontWeight: 400, paddingBottom: 4 }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, azureVal, cefrKey }) => {
            const cefrPct = Math.round(cefr.scores[cefrKey] ?? 0);
            const delta = Math.round(azureVal) - cefrPct;
            return (
              <tr key={cefrKey}>
                <td style={{ paddingBottom: 3, color: "#d1d5db" }}>{label}</td>
                <td style={{ textAlign: "center", color: wordColor(azureVal) }}>{Math.round(azureVal)}</td>
                <td style={{ textAlign: "center", color: wordColor(cefrPct) }}>{cefrPct}</td>
                <td style={{ textAlign: "center", color: Math.abs(delta) <= 10 ? "#9ca3af" : delta > 0 ? "#60a5fa" : "#f87171" }}>
                  {delta > 0 ? "+" : ""}{delta}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 6, color: "#4b5563", fontSize: 10 }}>
        Azure = phonétique acoustique · Claude = compétence conversationnelle
      </div>
    </div>
  );
}

// ─── Utterance mini-badges ────────────────────────────────────────────────────

function UtteranceBadges({ p }: { p: PronunciationResult }) {
  const dims: [string, number, string][] = [
    ["P", p.pronunciationScore, "Pronunciation"],
    ["A", p.accuracyScore, "Accuracy"],
    ["F", p.fluencyScore, "Fluency"],
    ["C", p.completenessScore, "Completeness"],
  ];
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
      {dims.map(([lbl, val, title]) => (
        <span
          key={lbl}
          title={`${title}: ${Math.round(val)}/100`}
          style={{
            background: wordColor(val),
            color: "#000",
            borderRadius: 3,
            padding: "1px 5px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "help",
          }}
        >
          {lbl}
          {Math.round(val)}
        </span>
      ))}
    </div>
  );
}

// ─── Word-annotated user message ──────────────────────────────────────────────

function UserWords({ words }: { words: WordScore[] }) {
  if (!words.length) return null;
  return (
    <>
      {words.map((w, i) => (
        <span
          key={i}
          title={`${w.word}: ${Math.round(w.accuracyScore)}/100${
            w.errorType !== "None" ? ` — ${w.errorType}` : ""
          }`}
          style={{
            color: wordColor(w.accuracyScore),
            marginRight: 4,
            cursor: "help",
            textDecoration: w.errorType !== "None" ? "underline dotted" : "none",
          }}
        >
          {w.word}
        </span>
      ))}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [language, setLanguage] = useState<Lang>("fr");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [history, setHistory] = useState<Msg[]>([]);
  const [partialUser, setPartialUser] = useState("");
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [cefrResult, setCefrResult] = useState<CefrResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const sttRef = useRef<AzureSTT | null>(null);
  const playerRef = useRef<StreamingAudioPlayer | null>(null);
  const liveAvatarRef = useRef<LiveAvatarHandle | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const historyRef = useRef<Msg[]>([]);
  historyRef.current = history;

  // Derived: average Azure pronunciation scores across all scored user turns
  const azureAvg = useMemo<AzureAvg | null>(() => {
    const scored = history.filter((m) => m.role === "user" && m.pronunciation);
    if (!scored.length) return null;
    const avg = (key: keyof PronunciationResult) => {
      const vals = scored.map((m) => m.pronunciation![key] as number);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const pronunciation = avg("pronunciationScore");
    const accuracy = avg("accuracyScore");
    const fluency = avg("fluencyScore");
    const completeness = avg("completenessScore");
    const score = Math.round((pronunciation + accuracy + fluency) / 3);
    return {
      pronunciation,
      accuracy,
      fluency,
      completeness,
      score,
      count: scored.length,
    };
  }, [history]);

  // ── timer ──
  useEffect(() => {
    if (!sessionStarted) return;
    const id = setInterval(() => {
      if (startedAtRef.current)
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStarted]);

  // Auto-evaluate at 5 min
  useEffect(() => {
    if (elapsed === 300 && !cefrResult && !evaluating) runEvaluation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  // ── session ──
  const startSession = async () => {
    setSessionStarted(true);
    startedAtRef.current = Date.now();
    if (!USE_HEYGEN) {
      playerRef.current = new StreamingAudioPlayer((amp) => {
        isSpeakingRef.current = amp > 0;
        setAmplitude(amp);
      });
    }

    sttRef.current = new AzureSTT(language, {
      onPartial: (text) => {
        if (isSpeakingRef.current) return;
        setPartialUser(text);
        if (USE_HEYGEN) liveAvatarRef.current?.startListening();
      },
      onFinal: async (text, pronunciation) => {
        if (!text.trim() || isProcessingRef.current || isSpeakingRef.current) return;
        setPartialUser("");
        if (USE_HEYGEN) liveAvatarRef.current?.stopListening();
        await handleUserTurn(text, pronunciation);
      },
      onError: (e) => console.error("STT error:", e),
    });
    await sttRef.current.start();

    // Kick off the conversation
    await handleUserTurn("__START__");
  };

  const handleUserTurn = async (userText: string, pronunciation?: PronunciationResult) => {
    isProcessingRef.current = true;
    const isStart = userText === "__START__";

    const newHistory: Msg[] = isStart
      ? historyRef.current
      : [...historyRef.current, { role: "user", content: userText, pronunciation }];

    if (!isStart) setHistory(newHistory);
    setStreamingAssistant("");

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language,
        history: newHistory,
        userMessage: isStart
          ? language === "fr"
            ? "Bonjour, démarrons la conversation."
            : "Hello, let's start the conversation."
          : userText,
      }),
    });

    if (!res.body) {
      isProcessingRef.current = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const evt of events) {
        const evtMatch = evt.match(/^event: (\w+)/m);
        const dataMatch = evt.match(/^data: (.+)$/m);
        if (!evtMatch || !dataMatch) continue;

        const type = evtMatch[1];
        const data = dataMatch[1];

        if (type === "text") {
          const { delta } = JSON.parse(data);
          assistantText += delta;
          setStreamingAssistant(assistantText);
        } else if (type === "audio") {
          if (USE_HEYGEN) {
            liveAvatarRef.current?.sendAudio(data);
          } else {
            playerRef.current?.playChunk(data);
          }
        } else if (type === "done") {
          const { fullText } = JSON.parse(data);
          setHistory((h) => [...h, { role: "assistant", content: fullText }]);
          setStreamingAssistant("");
          if (USE_HEYGEN) liveAvatarRef.current?.speakEnd();
        } else if (type === "error") {
          console.error("Stream error:", data);
        }
      }
    }
    isProcessingRef.current = false;
  };

  const runEvaluation = async () => {
    setEvaluating(true);
    const userTurns = historyRef.current
      .filter((m) => m.role === "user")
      .map((m) => m.content);

    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, userTurns, azureScores: azureAvg }),
    });
    const data = await res.json();
    setCefrResult(data);
    setEvaluating(false);
  };

  const stopSession = () => {
    sttRef.current?.stop();
    if (!USE_HEYGEN) playerRef.current?.stop();
    setSessionStarted(false);
  };

  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");

  return (
    <main style={{ display: "flex", height: "100vh", flexDirection: "column", background: "#0f172a", color: "#f1f5f9" }}>
      {/* ── header ── */}
      <header
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>CEFR Pronunciation POC</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {sessionStarted && (
            <span style={{ fontFamily: "monospace", fontSize: 13, color: elapsed >= 300 ? "#4ade80" : "#94a3b8" }}>
              {mm}:{ss} {elapsed >= 300 ? "✓" : ""}
            </span>
          )}
          {!sessionStarted ? (
            <>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Lang)}
                style={{ padding: "5px 8px", background: "#1e293b", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 4 }}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
                <option value="nl-BE">Nederlands (BE)</option>
              </select>
              <button onClick={startSession} style={btn("#4f46e5")}>
                Démarrer
              </button>
            </>
          ) : (
            <>
              <button onClick={runEvaluation} disabled={evaluating} style={btn("#10b981")}>
                {evaluating ? "Évaluation…" : "Évaluer (Claude)"}
              </button>
              <button onClick={stopSession} style={btn("#ef4444")}>
                Arrêter
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── body ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 520px", flex: 1, overflow: "hidden" }}>
        {/* Avatar */}
        <div style={{ position: "relative", overflow: "hidden" }}>
          {sessionStarted ? (
            USE_HEYGEN ? (
              <LiveAvatar ref={liveAvatarRef} onAmplitude={(amp) => setAmplitude(amp)} />
            ) : (
              <Avatar amplitude={amplitude} />
            )
          ) : (
            <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "#334155", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 48 }}>🎙️</div>
              <div>Démarre une session pour voir l&apos;avatar</div>
            </div>
          )}
          {/* Overlay: live captions */}
          {sessionStarted && (partialUser || streamingAssistant) && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                right: 16,
                padding: "10px 14px",
                background: "rgba(0,0,0,0.72)",
                borderRadius: 8,
                backdropFilter: "blur(4px)",
              }}
            >
              {partialUser && (
                <div style={{ fontStyle: "italic", color: "#94a3b8", fontSize: 14 }}>
                  🎤 {partialUser}
                </div>
              )}
              {streamingAssistant && (
                <div style={{ color: "#e2e8f0", fontSize: 14 }}>{streamingAssistant}</div>
              )}
            </div>
          )}
        </div>

        {/* Right panel */}
        <aside
          style={{
            borderLeft: "1px solid #1e293b",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Score panels */}
          <div style={{ padding: 12, borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: cefrResult ? "1fr 1fr" : "1fr",
                gap: 8,
                marginBottom: cefrResult && azureAvg ? 8 : 0,
              }}
            >
              <AzurePanel data={azureAvg} />
              {cefrResult && <CefrPanel result={cefrResult} />}
            </div>
            {cefrResult && azureAvg && (
              <ComparisonTable azure={azureAvg} cefr={cefrResult} />
            )}
          </div>

          {/* Transcript */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
              TRANSCRIPT
            </div>
            {history.length === 0 && (
              <p style={{ color: "#334155", fontSize: 13 }}>La conversation s&apos;affichera ici…</p>
            )}
            {history.map((m, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 10,
                  padding: "8px 10px",
                  background: m.role === "user" ? "#1e293b" : "#1e1b4b",
                  borderRadius: 6,
                  borderLeft: `3px solid ${m.role === "user" ? "#334155" : "#4f46e5"}`,
                }}
              >
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
                  {m.role === "user" ? "Vous" : "Avatar"}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {m.role === "user" && m.pronunciation?.words?.length ? (
                    <UserWords words={m.pronunciation.words} />
                  ) : (
                    m.content
                  )}
                </div>
                {m.role === "user" && m.pronunciation && (
                  <UtteranceBadges p={m.pronunciation} />
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    padding: "6px 14px",
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  };
}
