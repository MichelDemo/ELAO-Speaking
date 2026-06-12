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
  /**
   * Which engine produced these scores.
   * 'deepgram' = initial word-confidence proxy (shown while Azure is pending).
   * 'azure'    = server-side Azure Pronunciation Assessment REST result.
   */
  source?: "deepgram" | "azure";
}

export interface SttCallbacks {
  onPartial?: (text: string) => void;
  onFinal?: (text: string, pronunciation: PronunciationResult) => void;
  onError?: (err: unknown) => void;
}

// Scoring shared with app/api/pronunciation/route.ts — single source of truth.
import { discreteWordConfidence, wordAccuracy } from "@/lib/pronunciation-scoring";

interface RecognizerHandle {
  startContinuousRecognitionAsync(ok: () => void, err: (e: unknown) => void): void;
  stopContinuousRecognitionAsync(ok: () => void): void;
  close(): void;
}

/**
 * How long the SDK waits in silence before closing a speech segment.
 * Default (~650 ms) is tuned for fluent native speakers; CEFR learners pause
 * mid-sentence searching for words, so 650 ms chops their sentences apart.
 * 1500 ms is safe because segment closure no longer dispatches — the
 * punctuation-aware debounce below decides when the turn actually ends.
 * (SDK valid range: 100-5000.)
 */
const SEGMENTATION_SILENCE_MS = "1500";

/**
 * Punctuation-aware dispatch debounce. After a segment is recognized, wait
 * before treating the turn as finished; a `recognizing` partial cancels the
 * timer and the next segment merges into the same turn.
 *
 * Azure punctuates recognized text: a finished sentence gets terminal
 * punctuation (. ! ?), a mid-thought fragment usually doesn't. Use that:
 *   - Complete sentence  → short wait. Total silence ≈ 1500 + 900 = 2.4 s
 *     (was a flat 3.8 s — the "system takes too long to respond" complaint).
 *   - Incomplete fragment → long wait. Total ≈ 1500 + 2500 = 4.0 s, MORE
 *     mid-sentence protection than the old flat timing.
 * Worst case equals the old behaviour; the common case is 1.4 s faster.
 */
const DEBOUNCE_COMPLETE_MS = 900;
const DEBOUNCE_INCOMPLETE_MS = 2500;

export class AzureSTT {
  private recognizer: RecognizerHandle | null = null;
  private cb: SttCallbacks;
  private language: "fr" | "en" | "nl-BE";

  // Segments accumulated since the last dispatch — merged into one turn.
  private pendingText = "";
  private pendingWords: WordScore[] = [];
  private pendingDurationSec = 0;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(language: "fr" | "en" | "nl-BE", callbacks: SttCallbacks) {
    this.language = language;
    this.cb = callbacks;
  }

  /** Merge pending segments into a single turn and fire onFinal. */
  private dispatchPending() {
    if (this.dispatchTimer) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    if (!this.pendingText.trim()) return;

    const text = this.pendingText.trim();
    const words = this.pendingWords;
    const durationSec = this.pendingDurationSec;
    this.pendingText = "";
    this.pendingWords = [];
    this.pendingDurationSec = 0;

    // WPM across the whole merged turn (≥ 6 words to avoid skewing fluency).
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const wpm = durationSec > 0.5 && wordCount >= 6
      ? Math.round((wordCount / durationSec) * 60)
      : 0;

    const derivedScore = words.length > 0
      ? Math.round(words.reduce((s, w) => s + w.accuracyScore, 0) / words.length)
      : 0;

    this.cb.onFinal?.(text, {
      text,
      pronunciationScore: derivedScore,
      accuracyScore: derivedScore,
      wpm,
      words,
    });
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
    // Tolerate learner word-finding pauses — see SEGMENTATION_SILENCE_MS doc.
    speechConfig.setProperty(
      sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
      SEGMENTATION_SILENCE_MS
    );

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
      // User resumed speaking before the debounce expired — cancel the pending
      // dispatch so this speech merges into the same turn instead of the avatar
      // answering the first half of the sentence.
      if (this.dispatchTimer) {
        clearTimeout(this.dispatchTimer);
        this.dispatchTimer = null;
      }
      const display = this.pendingText
        ? `${this.pendingText} ${e.result.text}`
        : e.result.text;
      this.cb.onPartial?.(display);
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
            const phonemes = word.Phonemes ?? [];
            const accuracy = wordAccuracy(
              accuracyScore,
              phonemes.map((p) => p.PronunciationAssessment?.AccuracyScore ?? 100),
              errorType
            );
            return {
              word: word.Word ?? "",
              confidence: discreteWordConfidence(accuracy, errorType),
              accuracyScore: accuracy,
              errorType,
            };
          }
        );

        // Accumulate the segment instead of dispatching immediately. The SDK
        // closes a segment after SEGMENTATION_SILENCE_MS of silence, but a
        // learner may just be pausing — dispatch only after a debounce with
        // no new speech. A `recognizing` partial cancels the timer and merges
        // the next segment in.
        this.pendingText = this.pendingText
          ? `${this.pendingText} ${e.result.text}`
          : e.result.text;
        this.pendingWords.push(...words);
        this.pendingDurationSec += (e.result.duration ?? 0) / 10_000_000;

        // Punctuation-aware wait: Azure adds terminal punctuation to finished
        // sentences. Complete sentence → dispatch fast; dangling fragment →
        // give the learner extra time to find their words.
        const looksComplete = /[.!?…]\s*$/.test(this.pendingText.trim());
        if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
        this.dispatchTimer = setTimeout(() => {
          this.dispatchTimer = null;
          this.dispatchPending();
        }, looksComplete ? DEBOUNCE_COMPLETE_MS : DEBOUNCE_INCOMPLETE_MS);
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
    if (this.dispatchTimer) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    this.pendingText = "";
    this.pendingWords = [];
    this.pendingDurationSec = 0;

    const r = this.recognizer;
    if (r) {
      r.stopContinuousRecognitionAsync(() => r.close());
      this.recognizer = null;
    }
  }
}
