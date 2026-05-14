/**
 * Issues a 10-minute Azure Speech token for the browser SDK.
 * The AZURE_SPEECH_KEY never leaves the server.
 */
export async function GET() {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION ?? "westeurope";

  if (!key) {
    return new Response("AZURE_SPEECH_KEY missing", { status: 500 });
  }

  const res = await fetch(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key },
    }
  );

  if (!res.ok) {
    return new Response(`Token failed: ${await res.text()}`, { status: 500 });
  }

  const token = await res.text();
  return new Response(token, {
    headers: {
      "Content-Type": "text/plain",
      // Tokens expire in 10 min; tell the browser not to cache beyond 9 min
      "Cache-Control": "max-age=540",
    },
  });
}
