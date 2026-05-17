import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { ConvLang } from "@/lib/conversation-prompts";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const fd = await req.formData();
  const audio = fd.get("audio") as File | null;
  const language = (fd.get("language") as ConvLang | null) ?? "fr";

  if (!audio) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }

  const lang =
    language === "fr" ? "fr" : language === "nl-BE" ? "nl" : "en";

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: "whisper-1",
      language: lang,
      response_format: "verbose_json",
      // @ts-ignore — timestamp_granularities is valid but SDK types lag
      timestamp_granularities: ["word"],
    });

    return NextResponse.json(transcription);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
