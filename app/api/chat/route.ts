import Anthropic from "@anthropic-ai/sdk";
import { getSystemPrompt, type ConvLang } from "@/lib/conversation-prompts";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ChatRequest {
  language: ConvLang;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Starts an Azure TTS request immediately and returns a reader for the PCM stream.
 * Calling this function (without await) fires the HTTP request right away so it
 * runs in parallel with Claude generation.
 */
async function startTTS(
  text: string,
  language: ConvLang
): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  if (!key || !text.trim()) return null;

  const region = process.env.AZURE_SPEECH_REGION ?? "westeurope";
  const voice =
    language === "nl-BE" ? "nl-BE-DenaNeural" : "fr-FR-VivienneMultilingualNeural";
  const lang =
    language === "fr" ? "fr-FR" : language === "nl-BE" ? "nl-BE" : "en-US";

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
      },
      body: `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}"><prosody rate="-10%">${escapeXml(text)}</prosody></voice></speak>`,
    }
  );

  if (!res.ok || !res.body) {
    console.error("Azure TTS error:", res.status);
    return null;
  }

  return res.body.getReader();
}

/**
 * POST /api/chat
 * SSE stream:  event: text  → token delta (real-time, unblocked)
 *              event: audio → base64 PCM chunk (streamed per sentence)
 *              event: done  → { fullText }
 *              event: error → { stage, message }
 *
 * Latency strategy:
 *  1. TTS is fired immediately on each sentence boundary — NO await inside Claude loop.
 *  2. All TTS requests run in parallel with Claude generation.
 *  3. Azure TTS response is streamed (chunks forwarded as they arrive).
 *  4. By the time Claude finishes, sentence-1 TTS is already done or nearly done.
 */
export async function POST(req: Request) {
  const { language, history, userMessage } = (await req.json()) as ChatRequest;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));

      let fullText = "";
      let pending = "";

      // Each entry is a Promise that resolves to a streaming reader (or null).
      // Promises are pushed immediately when a sentence boundary is hit — no await.
      const ttsQueue: Promise<ReadableStreamDefaultReader<Uint8Array> | null>[] = [];

      try {
        const claudeStream = await anthropic.messages.stream({
          model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
          max_tokens: 300,
          system: getSystemPrompt(language),
          messages: [
            ...history.map(({ role, content }) => ({ role, content })),
            { role: "user", content: userMessage },
          ],
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const piece = event.delta.text;
            fullText += piece;
            pending += piece;
            send("text", JSON.stringify({ delta: piece }));

            const match = pending.match(/^([\s\S]*?[.!?…])\s/);
            if (match) {
              // Fire TTS immediately — no await, runs in parallel with Claude
              ttsQueue.push(startTTS(match[1], language));
              pending = pending.slice(match[0].length);
            }
          }
        }

        if (pending.trim()) {
          ttsQueue.push(startTTS(pending, language));
        }
      } catch (e) {
        send("error", JSON.stringify({ stage: "llm", message: String(e) }));
      }

      // Drain TTS readers in order. Buffer the entire PCM response for each
      // sentence and send it as ONE audio event. Sending many small events
      // (one per Azure read() chunk) creates arbitrary waveform boundaries
      // mid-sentence which cause audible clicks and static at the player.
      // Since TTS runs in parallel with Claude, the full sentence audio is
      // typically already available by the time we reach this drain phase —
      // buffering adds no meaningful latency.
      for (const readerPromise of ttsQueue) {
        const reader = await readerPromise;
        if (!reader) continue;
        try {
          const chunks: Buffer[] = [];
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value?.length) chunks.push(Buffer.from(value));
          }
          if (chunks.length) {
            send("audio", Buffer.concat(chunks).toString("base64"));
          }
        } finally {
          reader.releaseLock();
        }
      }

      send("done", JSON.stringify({ fullText }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
