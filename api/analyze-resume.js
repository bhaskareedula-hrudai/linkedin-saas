'use strict';

const { analyzeResumeFromUrl } = require('../lib/analyzeResume.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : null;
    console.log('[analyze-resume] Request body:', JSON.stringify(body));

    if (!body || !body.fileUrl || typeof body.fileUrl !== 'string' || !body.fileUrl.trim()) {
      return res.status(400).json({
        success: false,
        role: '',
        skills: [],
        topics: [],
        error: 'fileUrl is required',
      });
    }

    const result = await analyzeResumeFromUrl(body.fileUrl.trim());
    const payload = {
      success: result.success === true,
      role: result.role || '',
      skills: Array.isArray(result.skills) ? result.skills : [],
      topics: Array.isArray(result.topics) ? result.topics : [],
    };
    if (result.error) payload.error = result.error;

    console.log('[analyze-resume] Done — success:', payload.success, '| role:', payload.role);
    return res.status(200).json(payload);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unexpected error analyzing resume';
    console.error('[analyze-resume] Error:', msg);
    return res.status(500).json({ success: false, role: '', skills: [], topics: [], error: msg });
  }
};
