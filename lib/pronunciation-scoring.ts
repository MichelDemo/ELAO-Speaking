/**
 * Single source of truth for pronunciation scoring.
 *
 * Used by BOTH:
 *   - lib/azure-stt.ts          (pass 1: browser SDK, instant scores)
 *   - app/api/pronunciation/route.ts (pass 2: REST with reference text, accurate scores)
 *
 * Pass 2 overwrites pass 1 in the UI, so both passes MUST use identical
 * scoring or the final displayed scores silently revert to whatever this
 * file's older copy said (this exact bug shipped once — don't reintroduce it
 * by redefining these functions locally).
 */

/**
 * Word accuracy from phoneme scores: AVERAGE, not minimum.
 * Min-phoneme is too sensitive to single-phoneme ASR artifacts — one noisy
 * phoneme tanks the whole word even when the learner's pronunciation is fine.
 * The average is still more granular than Azure's word-level composite while
 * being robust to occasional recognition noise.
 */
export function wordAccuracy(wordLevelScore: number, phonemeScores: number[]): number {
  if (phonemeScores.length === 0) return Math.round(wordLevelScore);
  return Math.round(phonemeScores.reduce((a, b) => a + b, 0) / phonemeScores.length);
}

/**
 * Map accuracy + ErrorType to 4 discrete confidence levels (colour buckets).
 *
 * Thresholds are intentionally lenient for L2 learners:
 *   - Mispronunciation only triggers orange below 70 — above that, the model
 *     may have mis-transcribed rather than the learner having mispronounced.
 *   - Green starts at 75 — non-native "good enough" pronunciation is green.
 *
 *   1.00 → green   (≥ 75, or Mispronunciation ≥ 70)
 *   0.70 → yellow  (60-74)
 *   0.45 → orange  (Mispronunciation < 70, or score < 60)
 *   0.20 → red     (score < 30, or Omission)
 */
export function discreteWordConfidence(accuracyScore: number, errorType: string): number {
  if (accuracyScore < 30 || errorType === "Omission") return 0.20;
  if (errorType === "Mispronunciation" && accuracyScore < 70) return 0.45;
  if (accuracyScore < 60) return 0.45;
  if (accuracyScore < 75) return 0.70;
  return 1.00;
}
