import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Supabase dashboard may label this "publishable" (new) or "anon" (legacy) — same client role.
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!(url && supabaseKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, supabaseKey!)
  : null;
