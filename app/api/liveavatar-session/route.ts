import { NextResponse } from "next/server";

const API = "https://api.liveavatar.com";

export async function POST() {
  const apiKey = process.env.HEYGEN_API_KEY;
  const avatarId = process.env.HEYGEN_AVATAR_ID;

  if (!apiKey || !avatarId) {
    return NextResponse.json(
      { error: "HEYGEN_API_KEY or HEYGEN_AVATAR_ID not configured" },
      { status: 500 }
    );
  }

  // Step 1: create a session token scoped to LITE mode
  const tokenRes = await fetch(`${API}/v1/sessions/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ mode: "LITE", avatar_id: avatarId }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("LiveAvatar token error:", text);
    return NextResponse.json(
      { error: `Token creation failed (${tokenRes.status}): ${text}` },
      { status: 502 }
    );
  }

  const { data: tokenData } = await tokenRes.json();
  // tokenData: { session_id, session_token }

  // Step 2: start the session using the session token as Bearer
  const startRes = await fetch(`${API}/v1/sessions/start`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tokenData.session_token}`,
      "Content-Type": "application/json",
    },
  });

  if (!startRes.ok) {
    const text = await startRes.text();
    console.error("LiveAvatar start error:", text);
    return NextResponse.json(
      { error: `Session start failed (${startRes.status}): ${text}` },
      { status: 502 }
    );
  }

  const { data: sessionData } = await startRes.json();
  // sessionData: { session_id, livekit_url, livekit_client_token, livekit_agent_token, ws_url, ... }

  return NextResponse.json({
    session_id: sessionData.session_id,
    livekit_url: sessionData.livekit_url,
    livekit_token: sessionData.livekit_client_token,
    ws_url: sessionData.ws_url,
  });
}
