import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  CEFR_SYSTEM_PROMPT,
  buildEvaluationUserMessage,
} from "@/lib/cefr-prompt";
import type { ConvLang } from "@/lib/conversation-prompts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Deterministic CEFR level mapping — mirrors cefr-prompt.ts scale exactly.
 * Used to override Claude's subjective level assessment with the arithmetic result.
 */
function scoreToLevel(s: number): string {
  if (s <= 2)  return "A0";
  if (s <= 5)  return "A0 (25)";
  if (s <= 8)  return "A0 (50)";
  if (s <= 11) return "A0 (75)";
  if (s <= 16) return "A1";
  if (s <= 20) return "A1 (25)";
  if (s <= 24) return "A1 (50)";
  if (s <= 28) return "A1 (75)";
  if (s <= 32) return "A2";
  if (s <= 36) return "A2 (25)";
  if (s <= 40) return "A2 (50)";
  if (s <= 44) return "A2 (75)";
  if (s <= 48) return "B1";
  if (s <= 52) return "B1 (25)";
  if (s <= 56) return "B1 (50)";
  if (s <= 60) return "B1 (75)";
  if (s <= 64) return "B2";
  if (s <= 68) return "B2 (25)";
  if (s <= 72) return "B2 (50)";
  if (s <= 76) return "B2 (75)";
  if (s <= 80) return "C1";
  if (s <= 84) return "C1 (25)";
  if (s <= 87) return "C1 (50)";
  if (s <= 90) return "C1 (75)";
  return "C2";
}

interface AzureScores {
  pronunciation: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  score: number;
  count: number;
}

interface EvalRequest {
  language: ConvLang;
  userTurns: string[];
  azureScores?: AzureScores | null;
}

export async function POST(req: Request) {
  const { language, userTurns, azureScores } = (await req.json()) as EvalRequest;

  if (!userTurns.length) {
    return NextResponse.json(
      { error: "No user turns provided" },
      { status: 400 },
    );
  }

  try {
    const res = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      max_tokens: 1500,
      system: CEFR_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildEvaluationUserMessage(language, userTurns, azureScores ?? undefined) },
      ],
    });

    const text =
      res.content[0].type === "text" ? res.content[0].text : "";

    // Parser le JSON (Claude doit suivre le format strict du system prompt)
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const evaluation = JSON.parse(cleaned);

    // Override globalScore and level deterministically from the 4 criteria scores.
    // Claude sometimes maps the level subjectively — this guarantees the displayed
    // level always matches the arithmetic mean of the 4 scores.
    const { range = 0, accuracy = 0, fluency = 0, coherence = 0 } = evaluation.scores ?? {};
    const globalScore = Math.round((range + accuracy + fluency + coherence) / 4);
    evaluation.globalScore = globalScore;
    evaluation.level = scoreToLevel(globalScore);

    return NextResponse.json(evaluation);
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}
