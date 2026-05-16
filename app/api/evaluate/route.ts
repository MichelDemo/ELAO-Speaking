import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  CEFR_SYSTEM_PROMPT,
  buildEvaluationUserMessage,
} from "@/lib/cefr-prompt";
import type { ConvLang } from "@/lib/conversation-prompts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface SttContext {
  pronunciation: number;
  wpm: number;
  count: number;
}

interface EvalRequest {
  language: ConvLang;
  userTurns: string[];
  azureContext?: SttContext | null;
}

export async function POST(req: Request) {
  const { language, userTurns, azureContext } = (await req.json()) as EvalRequest;

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
        { role: "user", content: buildEvaluationUserMessage(language, userTurns, azureContext ?? undefined) },
      ],
    });

    const text =
      res.content[0].type === "text" ? res.content[0].text : "";

    // Strip any accidental markdown fences and parse
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const evaluation = JSON.parse(cleaned);

    return NextResponse.json(evaluation);
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}
