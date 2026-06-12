/**
 * Server-side Azure Pronunciation Assessment.
 *
 * Accepts a recorded audio blob (webm/opus or mp4) from the per-turn
 * MediaRecorder and returns a PronunciationResult with per-phoneme word scores.
 *
 * Key design: the Azure SDK transcript (pass 1) is passed as ReferenceText.
 * Azure's ASR normalises phoneme substitutions (it writes "the" even when the
 * learner said /z/), so scoring the audio against that reference correctly
 * exposes substitutions, omissions and insertions (EnableMiscue:true).
 *
 * The AZURE_SPEECH_KEY never leaves the server.
 */

import { discreteWordConfidence, wordAccuracy } from "@/lib/pronunciation-scoring";

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
  // Optional: when the caller provides the ASR transcript, we use it as the
  // pronunciation reference (EnableMiscue:true). This is the two-pass mode:
  // Azure SDK provides the transcript, then we score against it — NOT circular
  // because Azure's ASR normalises phoneme patterns (e.g. it writes "the" even
  // when the learner said /z/, so the reference correctly exposes the error).
  const referenceText = (formData.get("referenceText") as string | null) ?? "";

  if (!audio || audio.size === 0) {
    return new Response("No audio", { status: 400 });
  }

  console.log(`[pronunciation] blob=${audio.size}B type=${audio.type} lang=${langCode} wpm=${dgWpm} ref="${referenceText.slice(0, 40)}${referenceText.length > 40 ? "…" : ""}"`);

  const langMap: Record<string, string> = {
    fr: "fr-FR",
    en: "en-US",
    "nl-BE": "nl-BE",
  };

  // Two-pass mode (referenceText provided): use Azure's own ASR transcript as the
  // reference so we score the learner's actual phonemes against what those words
  // should sound like. EnableMiscue:true catches omissions and insertions.
  //
  // This is NOT the circular-reference problem that Deepgram had: Deepgram wrote
  // "ze" when the learner said /z/ for "the", so the reference matched the error.
  // Azure's ASR normalises to "the" even for /z/ input, so the reference correctly
  // exposes the substitution.
  //
  // Free-speech fallback (no referenceText): Azure uses its own phoneme transcription
  // to score — less accurate but still useful when no reference is available.
  const pronConfigJson = JSON.stringify(
    referenceText
      ? { ReferenceText: referenceText, GradingSystem: "HundredMark", Granularity: "Phoneme", EnableMiscue: true }
      : { ReferenceText: "",            GradingSystem: "HundredMark", Granularity: "Phoneme", EnableMiscue: false }
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
      phonemes.map((p) => p.PronunciationAssessment?.AccuracyScore ?? 100)
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
