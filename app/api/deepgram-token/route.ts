/**
 * Returns the Deepgram API key to the browser.
 * The key never appears in client-side bundles — it is always fetched at runtime.
 */
export async function GET() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return new Response("DEEPGRAM_API_KEY missing", { status: 500 });
  }
  return Response.json({ key });
}
