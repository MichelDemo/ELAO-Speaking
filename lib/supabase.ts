import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy singleton — not instantiated at module load time so Next.js static
// prerendering doesn't throw when env vars are absent at build time.
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase env vars not set");
    _client = createClient(url, key);
  }
  return _client;
}
