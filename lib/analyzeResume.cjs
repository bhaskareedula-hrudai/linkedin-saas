'use strict';

/**
 * Resume analysis using Google Gemini API (direct fetch — no SDK, no OpenAI).
 * Requires GEMINI_API_KEY in environment variables.
 * Primary model: gemini-1.5-flash (free tier compatible).
 */

const { assertAllowedStorageUrl } = require('./storageUrlAllowlist.cjs');

const httpFetch =
  typeof fetch === 'function'
    ? (...args) => fetch(...args)
    : (...args) => require('node-fetch')(...args);

const GEMINI_MODELS = [
  'gemini-1.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-8b',
];

const GEMINI_TIMEOUT_MS = 30000;

function getGeminiKey() {
  const key = process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim();
  if (key) return key;
  const alt = process.env.API_KEY && String(process.env.API_KEY).trim();
  if (alt && alt.startsWith('AIza')) return alt;
  return '';
}

function normalizeProfile(parsed) {
  const role = String(parsed.role ?? '').trim();
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : [];
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map((s) => String(s).trim()).filter(Boolean).slice(0, 5)
    : [];
  return { role, skills, topics };
}

function parseProfileJson(content) {
  const raw = String(content || '').trim();
  if (!raw) return { role: '', skills: [], topics: [] };

  console.log('[analyzeResume] RAW AI:', raw.slice(0, 300));

  const tryParse = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };

  // Try direct parse after stripping markdown fences
  let clean = raw.replace(/`json/gi, '').replace(/`/g, '').trim();
  let obj = tryParse(clean);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) return normalizeProfile(obj);

  clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) clean = fence[1].trim();

  obj = tryParse(clean);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) return normalizeProfile(obj);

  // Last resort: find first {...} block
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    obj = tryParse(jsonMatch[0]);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return normalizeProfile(obj);
  }

  console.error('[analyzeResume] JSON parse failed:', raw.slice(0, 400));
  return { role: '', skills: [], topics: [] };
}

function buildPrompt(resumeText, hint) {
  return `${hint ? hint + '\n\n' : ''}You are an expert recruiter. Analyze this resume and return ONLY valid JSON (no markdown, no explanation):

{"role":"single job title","skills":["skill1","skill2",...up to 10],"topics":["topic1",...up to 5 LinkedIn content themes]}

Resume:
${String(resumeText).slice(0, 8000)}`;
}

async function callGeminiChat(resumeText, hint) {
  const apiKey = getGeminiKey();
  console.log('[analyzeResume] GEMINI_API_KEY exists:', !!apiKey);

  if (!apiKey) {
    return { ok: false, error: 'GEMINI_API_KEY is not configured. Add it to Vercel environment variables.' };
  }

  const prompt = buildPrompt(resumeText, hint);
  let lastError = 'All Gemini models failed';
  let hitRateLimit = false;

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      console.log(`[analyzeResume] Trying model: ${model}`);

      const res = await httpFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = data?.error?.message || `Gemini HTTP ${res.status}`;
        console.error(`[analyzeResume] ${model} error ${res.status}:`, errMsg);
        if (res.status === 429) {
          hitRateLimit = true;
          lastError = 'Gemini rate limit reached. Please try again in a moment.';
          continue;
        }
        if (res.status === 400 || res.status === 403) {
          return { ok: false, error: `Gemini API error: ${errMsg}` };
        }
        lastError = errMsg;
        continue;
      }

      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!raw.trim()) {
        console.error(`[analyzeResume] Empty response from ${model}`);
        lastError = 'Empty response from Gemini';
        continue;
      }

      const parsed = parseProfileJson(raw);
      console.log(`[analyzeResume] SUCCESS with model: ${model}`);
      return { ok: true, role: parsed.role, skills: parsed.skills, topics: parsed.topics };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[analyzeResume] ${model} threw:`, msg);
      lastError = msg;
    }
  }

  if (hitRateLimit) return { ok: false, error: 'Gemini rate limit reached. Please try again in a moment.' };
  return { ok: false, error: lastError };
}

function outputInsufficient(ai) {
  return !String(ai.role || '').trim() || !Array.isArray(ai.skills) || ai.skills.length === 0;
}

function emptyResult(extra) {
  return { success: false, role: '', skills: [], topics: [], ...extra };
}

function pathnameLower(fileUrl) {
  try { return new URL(fileUrl).pathname.toLowerCase(); }
  catch { return String(fileUrl).split('?')[0].toLowerCase(); }
}

function detectKind(fileUrl, contentType) {
  const p = pathnameLower(fileUrl);
  if (p.endsWith('.pdf')) return 'pdf';
  if (p.endsWith('.docx')) return 'docx';
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('wordprocessingml') || ct.includes('officedocument')) return 'docx';
  return 'unknown';
}

async function extractTextFromBuffer(buffer, kind) {
  if (kind === 'pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const pdfData = await parser.getText();
      return String(pdfData.text || '').trim();
    } catch (pdfErr) {
      const msg = pdfErr && pdfErr.message ? pdfErr.message : String(pdfErr);
      if (msg.includes('Invalid PDF') || msg.includes('InvalidPDF') || msg.includes('FormatError')) {
        throw new Error('Could not read this PDF. It may be corrupted, password-protected, or scanned.');
      }
      throw pdfErr;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth');
    const docxData = await mammoth.extractRawText({ buffer });
    return String(docxData.value || '').trim();
  }
  return '';
}

/**
 * Download resume from URL, extract text, analyze with Gemini.
 * Never throws — returns structured result.
 */
async function analyzeResumeFromUrl(fileUrl) {
  try {
    const url = String(fileUrl || '').trim();
    if (!url) return emptyResult({ error: 'No file URL provided' });

    console.log('[analyzeResume] Processing:', url);
    assertAllowedStorageUrl(url);

    const fileResponse = await httpFetch(url);
    if (!fileResponse.ok) {
      console.error('[analyzeResume] Download failed:', fileResponse.status);
      return emptyResult({ error: `Failed to download resume (${fileResponse.status})` });
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const ct = fileResponse.headers.get('content-type') || '';
    const kind = detectKind(url, ct);

    if (kind === 'unknown') {
      return emptyResult({ error: 'Unsupported file type. Please upload a PDF or DOCX.' });
    }

    const extractedText = await extractTextFromBuffer(fileBuffer, kind);
    console.log('[analyzeResume] Extracted text length:', extractedText ? extractedText.length : 0);

    if (!extractedText || extractedText.length < 50) {
      return emptyResult({ error: 'Could not extract text from resume. Try a different file.' });
    }

    let ai = await callGeminiChat(extractedText, '');
    if (!ai.ok) {
      return emptyResult({ error: ai.error });
    }

    if (outputInsufficient(ai)) {
      console.log('[analyzeResume] First pass insufficient, retrying with hint...');
      const ai2 = await callGeminiChat(
        extractedText,
        'The previous answer was incomplete. Infer role (one job title), at least 5 skills, and 3 topics from the resume.'
      );
      if (ai2.ok && !outputInsufficient(ai2)) ai = ai2;
    }

    if (outputInsufficient(ai)) {
      return emptyResult({ error: 'Could not extract role and skills from resume. Try editing your profile manually.' });
    }

    console.log('[analyzeResume] Done — role:', ai.role, '| skills:', ai.skills.length);
    return {
      success: true,
      role: String(ai.role || '').trim(),
      skills: Array.isArray(ai.skills) ? ai.skills : [],
      topics: Array.isArray(ai.topics) ? ai.topics : [],
    };
  } catch (error) {
    console.error('[analyzeResume] Unexpected error:', error);
    return emptyResult({ error: error instanceof Error ? error.message : 'Unexpected error analyzing resume' });
  }
}

/**
 * Plain-text resume → structured profile using Gemini.
 * Throws on failure (used by generateProfileFromText.cjs).
 */
async function generateProfileFromPlainText(resumeText) {
  let ai = await callGeminiChat(resumeText, '');
  if (!ai.ok) throw new Error(ai.error || 'Gemini profile generation failed');

  if (outputInsufficient(ai)) {
    const ai2 = await callGeminiChat(
      resumeText,
      'The previous answer was incomplete. Infer role (one job title), at least 5 skills, and topics from the resume.'
    );
    if (ai2.ok && !outputInsufficient(ai2)) ai = ai2;
  }

  if (outputInsufficient(ai)) {
    throw new Error('Could not extract role, skills, or topics from resume text');
  }

  return {
    role: String(ai.role || '').trim(),
    skills: Array.isArray(ai.skills) ? ai.skills : [],
    topics: Array.isArray(ai.topics) ? ai.topics : [],
  };
}

module.exports = { analyzeResumeFromUrl, parseProfileJson, generateProfileFromPlainText };
