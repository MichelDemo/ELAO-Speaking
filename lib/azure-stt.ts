/**
 * Browser-side Azure Speech SDK client.
 * Runs continuous recognition with PronunciationAssessment attached.
 * The SDK is dynamically imported so it never runs during SSR.
 */

export interface WordScore {
  word: string;
  /** AccuracyScore / 100  →  0–1  (matches whisper-stt.ts interface consumed by page.tsx) */
  confidence: number;
  accuracyScore: number;
  /** "None" | "Omission" | "Insertion" | "Mispronunciation" | "UnexpectedBreak" | "MissingBreak" | "Monotone" */
  errorType: string;
}

export interface PronunciationResult {
  text: string;
  /** Overall composite score 0-100 */
  pronunciationScore: number;
  /** Phoneme-level accuracy 0-100 */
  accuracyScore: number;
  /** Words per minute — calculated from Azure result duration */
  wpm: number;
  words: WordScore[];
}

export interface SttCallbacks {
  onPartial?: (text: string) => void;
  onFinal?: (text: string, pronunciation: PronunciationResult) => void;
  onError?: (err: unknown) => void;
}

/**
 * Map Azure AccuracyScore + ErrorType to 4 discrete confidence levels.
 * Returns a value that falls cleanly into the 4 colour buckets in wordColor():
 *   1.00 → green   (correct    — errorType None, accuracy ≥ 80)
 *   0.70 → yellow  (acceptable — errorType None, accuracy 65-79)
 *   0.45 → orange  (imprecise  — Mispronunciation, or accuracy 40-64)
 *   0.20 → red     (incorrect  — accuracy < 40 or Omission)
 */
function discreteWordConfidence(accuracyScore: number, errorType: string): number {
  if (accuracyScore < 40 || errorType === "Omission") return 0.20;
  if (errorType === "Mispronunciation" || accuracyScore < 65) return 0.45;
  if (accuracyScore < 80) return 0.70;
  return 1.00;
}

interface RecognizerHandle {
  startContinuousRecognitionAsync(ok: () => void, err: (e: unknown) => void): void;
  stopContinuousRecognitionAsync(ok: () => void): void;
  close(): void;
}

export class AzureSTT {
  private recognizer: RecognizerHandle | null = null;
  private cb: SttCallbacks;
  private language: "fr" | "en" | "nl-BE";

  constructor(language: "fr" | "en" | "nl-BE", callbacks: SttCallbacks) {
    this.language = language;
    this.cb = callbacks;
  }

  async start() {
    // Dynamic import keeps the heavy SDK out of the SSR bundle
    const sdk = await import("microsoft-cognitiveservices-speech-sdk");

    // Fetch a short-lived token from our server (key never sent to browser)
    const tokenRes = await fetch("/api/speech-token");
    if (!tokenRes.ok) throw new Error("Speech token fetch failed");
    const { token, region } = await tokenRes.json();

    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechRecognitionLanguage =
      this.language === "fr" ? "fr-FR" :
      this.language === "nl-BE" ? "nl-BE" :
      "en-US";

    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();

    // Free-speak mode: Phoneme granularity so we get per-phoneme scores.
    // Using the minimum phoneme score per word is more sensitive to subtle
    // mispronunciations than the word-level average Azure reports.
    const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
      "",
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      false // enableMiscue (needs reference text)
    );

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronunciationConfig.applyTo(recognizer);
    // Store as the minimal interface we need
    this.recognizer = recognizer as unknown as RecognizerHandle;

    recognizer.recognizing = (_: unknown, e: { result: { text: string } }) => {
      this.cb.onPartial?.(e.result.text);
    };

    recognizer.recognized = (
      _: unknown,
      e: { result: { reason: number; text: string; duration: number } }
    ) => {
      if (
        e.result.reason === sdk.ResultReason.RecognizedSpeech &&
        e.result.text?.trim()
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pronResult = sdk.PronunciationAssessmentResult.fromResult(e.result as any);

        const words: WordScore[] = (pronResult.detailResult?.Words ?? []).map(
          (w: unknown) => {
            const word = w as {
              Word: string;
              PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
              Phonemes?: Array<{ PronunciationAssessment?: { AccuracyScore?: number } }>;
            };
            const accuracyScore = Math.round(word.PronunciationAssessment?.AccuracyScore ?? 100);
            const errorType = word.PronunciationAssessment?.ErrorType ?? "None";
            // Use the minimum phoneme score — a single bad phoneme pulls the
            // whole word down, catching subtle mispronunciations the word-level
            // average would smooth over.
            const phonemes = word.Phonemes ?? [];
            const minPhoneme = phonemes.length > 0
              ? Math.min(...phonemes.map((p) => p.PronunciationAssessment?.AccuracyScore ?? 100))
              : accuracyScore;
            return {
              word: word.Word ?? "",
              confidence: discreteWordConfidence(minPhoneme, errorType),
              accuracyScore: minPhoneme,
              errorType,
            };
          }
        );

        // WPM only for substantive turns (≥ 6 words); short answers would
        // skew the fluency average downward.
        const durationSec = (e.result.duration ?? 0) / 10_000_000;
        const wordCount = e.result.text.trim().split(/\s+/).filter(Boolean).length;
        const wpm = durationSec > 0.5 && wordCount >= 6
          ? Math.round((wordCount / durationSec) * 60)
          : 0;

        this.cb.onFinal?.(e.result.text, {
          text: e.result.text,
          pronunciationScore: pronResult.pronunciationScore ?? 0,
          accuracyScore: pronResult.accuracyScore ?? 0,
          wpm,
          words,
        });
      }
    };

    recognizer.canceled = (_: unknown, e: { reason: number; errorDetails?: string }) => {
      // reason 0 = EndOfStream (normal stop), anything else is an error
      if (e.reason !== 0) {
        this.cb.onError?.(
          new Error(`Azure STT canceled: ${e.errorDetails ?? "unknown"}`)
        );
      }
    };

    recognizer.startContinuousRecognitionAsync(
      () => {},
      (err: unknown) => this.cb.onError?.(err)
    );
  }

  stop() {
    const r = this.recognizer;
    if (r) {
      r.stopContinuousRecognitionAsync(() => r.close());
      this.recognizer = null;
    }
  }
}
