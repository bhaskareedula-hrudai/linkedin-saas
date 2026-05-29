import { createClient } from '@supabase/supabase-js';

// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in Vercel env vars.
// They must point to the SAME Supabase project as SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on the server.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://zocwbfxrkgghriudvlia.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Returns the base origin URL for Supabase redirectTo parameters.
 * Supabase rejects URLs containing '#' hash fragments, so we use only the origin.
 * After redirect, Supabase appends ?code= or ?token_hash= as query params which
 * detectSessionInUrl: true handles automatically.
 */
function getBaseRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin + '/';
}

/** After signup email confirmation — redirects to origin/ with token in query params. */
export function getEmailConfirmRedirectTo(): string {
  return getBaseRedirectUrl();
}

/** After password reset email — redirects to origin/ with recovery token in query params. */
export function getPasswordResetRedirectTo(): string {
  return getBaseRedirectUrl();
}

/** Redirect for Supabase OAuth (Google, LinkedIn). Uses current origin to support all deployments. */
export function getOAuthRedirectTo(): string {
  return getBaseRedirectUrl();
}

/**
 * Use when enabling LinkedIn (or other) OAuth through Supabase Auth.
 * Ensure https://*.vercel.app/** is added in Supabase Dashboard → Authentication → URL configuration.
 */
export async function signInWithLinkedInOAuth() {
  return supabase.auth.signInWithOAuth({
    provider: 'linkedin',
    options: {
      redirectTo: getOAuthRedirectTo(),
    },
  });
}
