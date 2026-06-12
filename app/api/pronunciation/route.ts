/**
 * Server-side Azure Pronunciation Assessment with LLM reference correction.
 *
 * Accepts a recorded audio blob (webm/opus or mp4) from the per-turn
 * MediaRecorder and returns a PronunciationResult with per-phoneme word scores.
 *
 * Why the LLM step is load-bearing:
 *   Scoring audio against the ASR's own transcript of that audio is partially
 *   circular — when a learner says "I sink so", the ASR often writes "sink"
 *   (a valid word matching the bad pronunciation), so the reference contains
 *   the error and Azure scores /sɪŋk/ against "sink" → perfect. Claude sees
 *   the transcript plus the examiner's question and reconstructs the INTENDED
 *   text ("I think so") while preserving the learner's genuine grammar errors.
 *   Azure then scores the actual phonemes against the intended words —
 *   /s/ vs expected /θ/ → Mispronunciation flagged. That is the assessment
 *   reference-text mode working as designed.
 *
 * The AZURE_SPEECH_KEY and ANTHROPIC_API_KEY never leave the server.
 */

import Anthropic from "@anthropic-ai/sdk";
import { discreteWordConfidence, wordAccuracy } from "@/lib/pronunciation-scoring";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORRECTION_SYSTEM = `You normalise automatic speech-recognition (ASR) transcripts of second-language learners so their pronunciation can be assessed against the words they actually meant to say.

Rewrite the transcript as the words the learner most plausibly INTENDED:
- Replace ASR mishearings and phonetically garbled words with the intended word. A mispronounced word is often transcribed as a similar-sounding DIFFERENT word ("I sink so" → "I think so"; "il fo parti" → "il faut partir"). Use the examiner's question to infer what the learner was answering.
- PRESERVE the learner's grammar mistakes, word order, repetitions and filler words exactly as they are — do not improve their language, only undo transcription errors.
- Keep the word count as close to the original as possible.
- If the transcript already reads as intended, return it unchanged.

Return ONLY the corrected text. No explanation, no quotes, no preamble.`;

/**
 * Ask Claude for the intended text. Falls back to the raw ASR transcript on
 * any failure or if the correction drifts too far (word-count sanity guard —
 * a reference misaligned with the audio produces spurious Omission/Insertion
 * flags, which is worse than a slightly circular reference).
 */
async function intendedText(asrText: string, langLabel: string, context: string): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: process.env.ANTHROPIC_CORRECTION_MODEL ?? "claude-opus-4-8",
      max_tokens: 300,
      system: CORRECTION_SYSTEM,
      messages: [{
        role: "user",
        content:
          `Language: ${langLabel}\n` +
          (context ? `Examiner's question: "${context}"\n` : "") +
          `ASR transcript of the learner's reply:\n"${asrText}"`,
      }],
    });
    const out = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
    if (!out) return asrText;
    const inWords = asrText.split(/\s+/).filter(Boolean).length;
    const outWords = out.split(/\s+/).filter(Boolean).length;
    if (Math.abs(outWords - inWords) > Math.max(3, Math.round(inWords * 0.3))) {
      console.warn(`[pronunciation] correction drifted (${inWords}→${outWords} words), using raw ASR text`);
      return asrText;
    }
    return out;
  } catch (e) {
    console.warn("[pronunciation] correction failed, using raw ASR text:", e);
    return asrText;
  }
}

export async function POST(req: Request) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION ?? "westeurope";

  if (!key) {
    return new Response("AZURE_SPEECH_KEY missing", { status: 500 });
  }

  const formData = await req.formData();
  const audio = formData.get("audio") as Blob | null;
  const langCode = (formData.get("language") as string | null) ?? "fr";
  const dgWpm = parseInt((formData.get("wpm") as string | null) ?? "0", 10);
  // ASR transcript of this turn (from the browser Azure SDK).
  const referenceText = (formData.get("referenceText") as string | null) ?? "";
  // The examiner's question the learner was answering — context for correction.
  const context = (formData.get("context") as string | null) ?? "";

  if (!audio || audio.size === 0) {
    return new Response("No audio", { status: 400 });
  }

  console.log(`[pronunciation] blob=${audio.size}B type=${audio.type} lang=${langCode} wpm=${dgWpm} ref="${referenceText.slice(0, 40)}${referenceText.length > 40 ? "…" : ""}"`);

  const langMap: Record<string, string> = {
    fr: "fr-FR",
    en: "en-US",
    "nl-BE": "nl-BE",
  };
  const langLabel =
    langCode === "fr" ? "French" :
    langCode === "nl-BE" ? "Dutch (Belgian)" :
    "English";

  // LLM-corrected reference: what the learner INTENDED to say. This is what
  // breaks the ASR circularity — see the header comment.
  const correctedReference = referenceText
    ? await intendedText(referenceText, langLabel, context)
    : "";
  if (correctedReference && correctedReference !== referenceText) {
    console.log(`[pronunciation] corrected reference: "${referenceText}" → "${correctedReference}"`);
  }

  // Reference mode (EnableMiscue:true) scores the audio's phonemes against the
  // expected phonemes of the corrected reference — catching substitutions,
  // omissions and insertions. Free-speech fallback when no transcript provided.
  const pronConfigJson = JSON.stringify(
    correctedReference
      ? { ReferenceText: correctedReference, GradingSystem: "HundredMark", Granularity: "Phoneme", EnableMiscue: true }
      : { ReferenceText: "",                 GradingSystem: "HundredMark", Granularity: "Phoneme", EnableMiscue: false }
  );
  const pronConfigB64 = Buffer.from(pronConfigJson).toString("base64");

  // Normalise Content-Type: Azure is strict about the exact string.
  // audio/webm;codecs=opus → audio/webm;codecs=opus  (Chrome)
  // audio/mp4             → audio/mp4               (Safari)
  // Anything else         → audio/webm               (safe fallback)
  const rawType = audio.type ?? "";
  const contentType = rawType.startsWith("audio/mp4")
    ? "audio/mp4"
    : rawType.includes("webm")
    ? "audio/webm;codecs=opus"
    : "audio/webm;codecs=opus";

  const azureRes = await fetch(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${langMap[langCode] ?? "fr-FR"}&format=detailed`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": contentType,
        "Pronunciation-Assessment": pronConfigB64,
      },
      body: await audio.arrayBuffer(),
    }
  );

  if (!azureRes.ok) {
    const errText = await azureRes.text();
    console.error("Azure pronunciation REST error:", azureRes.status, errText);
    return new Response(`Azure error: ${azureRes.status}`, { status: 502 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await azureRes.json() as any;

  if (data.RecognitionStatus !== "Success" || !data.NBest?.[0]) {
    // Speech not recognised — silence, background noise, or clip too short.
    console.warn(`[pronunciation] Azure no-speech: status=${data.RecognitionStatus}`);
    return Response.json(null);
  }

  const best = data.NBest[0];

  const words = (best.Words ?? []).map((w: {
    Word?: string;
    PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
    Phonemes?: Array<{ PronunciationAssessment?: { AccuracyScore?: number } }>;
  }) => {
    const acc = Math.round(w.PronunciationAssessment?.AccuracyScore ?? 100);
    const errType = w.PronunciationAssessment?.ErrorType ?? "None";
    const phonemes = w.Phonemes ?? [];
    // Avg-phoneme + lenient thresholds via the shared scoring module —
    // MUST match pass 1 (lib/azure-stt.ts) or pass 2 silently reverts the
    // displayed scores to a different scale when it overwrites them.
    const accuracy = wordAccuracy(
      acc,
      phonemes.map((p) => p.PronunciationAssessment?.AccuracyScore ?? 100),
      errType
    );
    return {
      word: w.Word ?? "",
      confidence: discreteWordConfidence(accuracy, errType),
      accuracyScore: accuracy,
      errorType: errType,
    };
  });

  // Duration is in 100-nanosecond ticks; 1 s = 10 000 000 ticks.
  // Prefer Azure's measurement; fall back to Deepgram WPM for short clips.
  const durationSec = (data.Duration ?? 0) / 10_000_000;
  const wordCount = (best.Display ?? "").trim().split(/\s+/).filter(Boolean).length;
  const wpm =
    durationSec > 0.5 && wordCount >= 6
      ? Math.round((wordCount / durationSec) * 60)
      : dgWpm;

  const derivedScore =
    words.length > 0
      ? Math.round(
          words.reduce((s: number, w: { accuracyScore: number }) => s + w.accuracyScore, 0) /
            words.length
        )
      : Math.round(best.PronunciationAssessment?.PronScore ?? 0);

  console.log(`[pronunciation] OK text="${best.Display}" score=${derivedScore} wpm=${wpm} words=${words.length}`);
  console.log(`[pronunciation] word scores: ${words.map((w: { word: string; accuracyScore: number; errorType: string }) => `${w.word}(${w.accuracyScore},${w.errorType})`).join(" ")}`);

  return Response.json({
    text: best.Display ?? "",
    pronunciationScore: derivedScore,
    accuracyScore: derivedScore,
    wpm,
    words,
    source: "azure",
  });
}
