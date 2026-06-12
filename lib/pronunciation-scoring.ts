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
 *
 * Scoring philosophy:
 *   - UNFLAGGED words: lenient. Avg-phoneme (robust to single-phoneme ASR
 *     noise) + generous numeric bands. L2 "good enough" stays green.
 *   - FLAGGED words (ErrorType=Mispronunciation): strict. A mispronunciation
 *     is typically ONE wrong phoneme ("ze" for "the") — averaging it away
 *     across the word's other correct phonemes hides exactly the error Azure
 *     detected. Use min-phoneme and always show at least orange.
 */

/**
 * Word accuracy from phoneme scores.
 *   - Mispronunciation-flagged words → MINIMUM phoneme score (surface the error)
 *   - everything else               → AVERAGE phoneme score (robust to noise)
 */
export function wordAccuracy(
  wordLevelScore: number,
  phonemeScores: number[],
  errorType: string,
): number {
  if (phonemeScores.length === 0) return Math.round(wordLevelScore);
  if (errorType === "Mispronunciation") {
    return Math.round(Math.min(...phonemeScores));
  }
  return Math.round(phonemeScores.reduce((a, b) => a + b, 0) / phonemeScores.length);
}

/**
 * Map accuracy + ErrorType to 4 discrete confidence levels (colour buckets).
 *
 *   1.00 → green   (unflagged, ≥ 75)
 *   0.70 → yellow  (unflagged, 60-74)
 *   0.45 → orange  (any Mispronunciation, or unflagged < 60)
 *   0.20 → red     (score < 30, or Omission)
 *
 * Mispronunciation ALWAYS caps at orange: Azure's ErrorType is its
 * purpose-built L2 error detector — a previous version let flagged words
 * with decent avg scores show green, and real mispronunciations sailed
 * through invisibly.
 */
export function discreteWordConfidence(accuracyScore: number, errorType: string): number {
  if (accuracyScore < 30 || errorType === "Omission") return 0.20;
  if (errorType === "Mispronunciation") return 0.45;
  if (accuracyScore < 60) return 0.45;
  if (accuracyScore < 75) return 0.70;
  return 1.00;
}
