// One-time classroom setup: copy this file to `supabase-config.js` (same
// folder as index.html) and paste your project's values. Every device that
// opens the game from this address — teacher whiteboard and learner phones —
// inherits the connection, so nobody types keys on join day.
//
// Find both values under Supabase → Project Settings → API:
//   SUPABASE_URL      the https://xyzcompany.supabase.co project URL
//   SUPABASE_ANON_KEY the "anon" / "public" key (safe to share read-only;
//                     rooms are still gated by the 4-digit password)
//
// Local runs read `supabase-config.js` (same folder, ignored by git).
// GitHub Pages builds inject it from the SUPABASE_URL / SUPABASE_ANON_KEY repo
// Secrets instead — real keys are never committed. Prefer a dedicated free
// Supabase project for classroom races.
export const SUPABASE_URL = 'https://xyzcompany.supabase.co';
export const SUPABASE_ANON_KEY = 'paste-the-anon-public-key-here';
