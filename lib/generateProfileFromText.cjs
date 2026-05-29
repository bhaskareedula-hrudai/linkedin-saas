'use strict';

/**
 * Text-only profile extraction for /api/generate-profile.
 * Uses Gemini via analyzeResume.cjs (direct fetch, no SDK, no OpenAI).
 * Requires GEMINI_API_KEY in environment variables.
 */

const { generateProfileFromPlainText } = require('./analyzeResume.cjs');

async function generateProfileFromText(resumeText) {
  const trimmed = String(resumeText || '').trim();
  if (!trimmed) {
    throw new Error('Resume text is empty');
  }
  return await generateProfileFromPlainText(trimmed);
}

module.exports = { generateProfileFromText };
