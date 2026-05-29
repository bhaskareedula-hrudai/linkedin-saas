'use strict';

// Top-level require so Vercel bundles automation.cjs (static string path = bundler can resolve it).
// automation.cjs uses direct fetch to Gemini API — no @google/generative-ai SDK dependency.
const { runAutomation } = require('../../lib/automation.cjs');

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();

async function getUserIdFromToken(token) {
  if (!SUPABASE_URL || !ANON_KEY || !token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.id ?? null;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const userId = await getUserIdFromToken(token);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const result = await runAutomation(userId);

    if (!result.success) {
      console.error('[automation/run] runAutomation failed:', result.error);
      return res.status(422).json({ success: false, error: result.error });
    }

    console.log(`[automation/run] success user=${userId} topic="${result.topic}"`);
    return res.status(200).json({
      success: true,
      message: 'Post generated and published to LinkedIn.',
      topic: result.topic,
      post_url: result.post_url,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected server error.';
    console.error('[automation/run] caught error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
