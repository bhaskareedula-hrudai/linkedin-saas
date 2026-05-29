'use strict';

const { generateProfileFromText } = require('../lib/generateProfileFromText.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const text = body.text;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    console.log('[generate-profile] Analyzing text length:', text.trim().length);
    const profile = await generateProfileFromText(text.trim());
    console.log('[generate-profile] Done — role:', profile.role, '| skills:', profile.skills.length);
    return res.status(200).json(profile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate profile';
    console.error('[generate-profile] Error:', msg);
    return res.status(500).json({ error: msg });
  }
};
