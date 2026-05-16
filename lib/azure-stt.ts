/**
 * Browser-side Azure Speech SDK client.
 * Runs continuous recognition with PronunciationAssessment attached.
 * The SDK is dynamically imported so it never runs during SSR.
 */

export interface WordScore {
  word: string;
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
  /** Speech rate / naturalness 0-100 */
  fluencyScore: number;
  /** How many expected words were produced 0-100 */
  completenessScore: number;
  words: WordScore[];
}

export interface AzureSttCallbacks {
  onPartial?: (text: string) => void;
  onFinal?: (text: string, pronunciation: PronunciationResult) => void;
  onError?: (err: unknown) => void;
}

interface RecognizerHandle {
  startContinuousRecognitionAsync(ok: () => void, err: (e: unknown) => void): void;
  stopContinuousRecognitionAsync(ok: () => void): void;
  close(): void;
}

export class AzureSTT {
  private recognizer: RecognizerHandle | null = null;
  private cb: AzureSttCallbacks;
  private language: "fr" | "en" | "nl-BE";
  private region: string;

  constructor(language: "fr" | "en" | "nl-BE", callbacks: AzureSttCallbacks, region = "westeurope") {
    this.language = language;
    this.cb = callbacks;
    this.region = region;
  }

  async start() {
    // Dynamic import keeps the heavy SDK out of the SSR bundle
    const sdk = await import("microsoft-cognitiveservices-speech-sdk");

    // Fetch a short-lived token from our server (key never sent to browser)
    const tokenRes = await fetch("/api/speech-token");
    if (!tokenRes.ok) throw new Error("Speech token fetch failed");
    const token = await tokenRes.text();

    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, this.region);
    speechConfig.speechRecognitionLanguage =
      this.language === "fr" ? "fr-FR" :
      this.language === "nl-BE" ? "nl-BE" :
      "en-US";

    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();

    // Free-speak mode: empty referenceText → assess without a fixed script
    const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
      "",
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Word,
      false // enableMiscue (needs reference text)
    );

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronunciationConfig.applyTo(recognizer);
    // Store as the minimal interface we need
    this.recognizer = recognizer as unknown as RecognizerHandle;

    recognizer.recognizing = (_: unknown, e: { result: { text: string } }) => {
      this.cb.onPartial?.(e.result.text);
    };

    recognizer.recognized = (_: unknown, e: { result: { reason: number; text: string } }) => {
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
            };
            return {
              word: word.Word ?? "",
              accuracyScore: word.PronunciationAssessment?.AccuracyScore ?? 0,
              errorType: word.PronunciationAssessment?.ErrorType ?? "None",
            };
          }
        );

        this.cb.onFinal?.(e.result.text, {
          text: e.result.text,
          pronunciationScore: pronResult.pronunciationScore ?? 0,
          accuracyScore: pronResult.accuracyScore ?? 0,
          fluencyScore: pronResult.fluencyScore ?? 0,
          completenessScore: pronResult.completenessScore ?? 0,
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
