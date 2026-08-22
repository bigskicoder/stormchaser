import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

/**
 * Server-only client using the service-role key, which bypasses RLS.
 * Use for cron jobs, admin routes, and anything writing to the DB.
 * Never import this from a Client Component or expose it to the browser.
 */
export function getServiceDb(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  serviceClient = createClient(url, key, {
    auth: { persistSession: false },
  });
  return serviceClient;
}

/**
 * Anon-key client, safe for read-only public-site queries (subject to the
 * RLS policies in supabase/migrations/0002_rls.sql). Usable server- or
 * client-side.
 */
export function getAnonDb(): SupabaseClient {
  if (anonClient) return anonClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars"
    );
  }

  anonClient = createClient(url, key, {
    auth: { persistSession: false },
  });
  return anonClient;
}
