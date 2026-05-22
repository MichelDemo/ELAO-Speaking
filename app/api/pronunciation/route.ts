/**
 * Server-side Azure Pronunciation Assessment.
 *
 * Accepts a recorded audio blob (webm/opus or mp4) from the per-turn
 * MediaRecorder and returns a PronunciationResult with per-phoneme word scores.
 *
 * Key design: we pass Deepgram's transcript as the ReferenceText.
 * In pure free-speech mode (no reference) Azure scores your pronunciation
 * against its own transcription — so "ze" → transcribed as "ze" → perfect score.
 * With Deepgram's transcript as reference, Azure compares the audio phonemes
 * against the expected phonemes of those words. When Deepgram's LM corrects
 * "ze" → "the", Azure detects the mismatch and flags a Mispronunciation.
 *
 * The AZURE_SPEECH_KEY never leaves the server.
 */

/** Discrete confidence level → 4 colour buckets (matches wordColor() in page.tsx) */
function discreteWordConfidence(accuracyScore: number, errorType: string): number {
  if (accuracyScore < 40 || errorType === "Omission") return 0.20;   // red
  if (errorType === "Mispronunciation" || accuracyScore < 65) return 0.45; // orange
  if (accuracyScore < 80) return 0.70;  // yellow
  return 1.00;  // green
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
  // Deepgram's transcript used as reference — enables Mispronunciation detection.
  const referenceText = ((formData.get("referenceText") as string | null) ?? "").trim();

  if (!audio || audio.size === 0) {
    return new Response("No audio", { status: 400 });
  }

  const langMap: Record<string, string> = {
    fr: "fr-FR",
    en: "en-US",
    "nl-BE": "nl-BE",
  };

  // With a reference text: enable miscue detection so Azure catches omissions,
  // insertions, and phoneme-level mismatches against the intended words.
  // Without (shouldn't happen in normal flow): fall back to free-speech mode.
  const pronConfigJson = JSON.stringify(
    referenceText
      ? {
          ReferenceText: referenceText,
          GradingSystem: "HundredMark",
          Granularity: "Phoneme",
          EnableMiscue: true,
        }
      : {
          ReferenceText: "",
          GradingSystem: "HundredMark",
          Granularity: "Phoneme",
          EnableMiscue: false,
        }
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
    console.warn("Azure pronunciation: no speech recognised. Status:", data.RecognitionStatus);
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
    // Use the minimum phoneme score — a single bad phoneme drags the word down,
    // catching subtle mispronunciations the word-level average would smooth over.
    const minPhoneme = phonemes.length > 0
      ? Math.min(...phonemes.map((p) => p.PronunciationAssessment?.AccuracyScore ?? 100))
      : acc;
    return {
      word: w.Word ?? "",
      confidence: discreteWordConfidence(minPhoneme, errType),
      accuracyScore: minPhoneme,
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

  return Response.json({
    text: best.Display ?? "",
    pronunciationScore: derivedScore,
    accuracyScore: derivedScore,
    wpm,
    words,
  });
}
