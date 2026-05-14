import { NextResponse } from "next/server";

type Action = "speak" | "interrupt" | "stop";

interface TaskRequest {
  session_id: string;
  action: Action;
  text?: string;
}

const HEYGEN_ENDPOINTS: Record<Action, string> = {
  speak: "https://api.heygen.com/v1/streaming.task",
  interrupt: "https://api.heygen.com/v1/streaming.interrupt",
  stop: "https://api.heygen.com/v1/streaming.stop",
};

export async function POST(req: Request) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HEYGEN_API_KEY not configured" }, { status: 500 });
  }

  const { session_id, action, text }: TaskRequest = await req.json();

  const body: Record<string, unknown> = { session_id };
  if (action === "speak" && text) {
    body.text = text;
    body.task_type = "talk";
    body.task_mode = "async";
  }

  const res = await fetch(HEYGEN_ENDPOINTS[action], {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`HeyGen ${action} error:`, errorText);
    return NextResponse.json(
      { error: `HeyGen ${action} failed (${res.status}): ${errorText}` },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data);
}
