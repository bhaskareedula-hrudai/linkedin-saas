'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();

// ── Prompts ───────────────────────────────────────────────────────────────────

const POST_ANGLES = [
  'share a personal lesson learned',
  'give a practical how-to tip',
  'highlight a common mistake to avoid',
  'share an inspiring industry trend',
  'give a step-by-step beginner guide',
  'compare two approaches or tools',
  'share a surprising insight or statistic',
  'give an actionable career advice',
];

function buildTextPrompt(role, skills, topic, angle) {
  return `You are a professional LinkedIn content writer.

Write a LinkedIn post for the following user profile:

Role: ${role}
Skills: ${skills.join(', ')}
Topic: ${topic}
Angle for this post: ${angle}

Rules:
- Professional and friendly tone
- 80–120 words
- The angle MUST shape the entire post — do not ignore it
- Use role-related emojis within the text (not at the start)
- Do not add emojis at the very beginning
- 5 to 6 relevant hashtags at the end
- Clear, human-sounding content
- Return the result in one paragraph only without line breaks
- Do not use quotation marks
- Do NOT include any labels like "TEXT:" or "IMAGE:"`;
}

function buildImagePrompt(role, topic, angle) {
  return `Generate structured content for a LinkedIn infographic image.

Topic: ${topic}
Role: ${role}
Angle for this infographic: ${angle}

Output ONLY this exact format (no other text before or after):
TITLE: [strong 3-5 word title in uppercase style]

SECTION 1: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

SECTION 2: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

SECTION 3: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

SECTION 4: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

TAKEAWAY: [one-line insight]`;
}

function buildCombinedPrompt(role, skills, topic, angle) {
  return `You are a professional LinkedIn content writer.

Create content for a LinkedIn post that has a text caption AND an infographic image.

Role: ${role}
Skills: ${skills.join(', ')}
Topic: ${topic}
Angle for this post: ${angle}

Output ONLY this exact format:

TEXT:
[Write a 80-120 word professional LinkedIn caption here. One paragraph, no line breaks, emojis within text, 5-6 hashtags at end. No quotation marks.]

IMAGE:
TITLE: [strong 3-5 word title in uppercase style]

SECTION 1: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

SECTION 2: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

SECTION 3: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

SECTION 4: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

TAKEAWAY: [one-line insight]`;
}

// ── Content helpers ───────────────────────────────────────────────────────────

function parseList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      return Array.isArray(p) ? p.filter(Boolean) : [t];
    } catch {
      return t.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseImageSection(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const result = { title: '', sections: [], takeaway: '' };
  let currentSection = null;

  for (const line of lines) {
    if (/^TITLE:/i.test(line)) {
      result.title = line.replace(/^TITLE:\s*/i, '').trim();
    } else if (/^SECTION \d+:/i.test(line)) {
      currentSection = { heading: line.replace(/^SECTION \d+:\s*/i, '').trim(), bullets: [] };
      result.sections.push(currentSection);
    } else if (/^[•\-\*]/.test(line)) {
      if (currentSection) currentSection.bullets.push(line.slice(1).trim());
    } else if (/^TAKEAWAY:/i.test(line)) {
      result.takeaway = line.replace(/^TAKEAWAY:\s*/i, '').trim();
    }
  }

  return result;
}

function parsePostContent(postType, raw) {
  const content = raw.trim();

  if (postType === 1) {
    return { text: content, imageData: null };
  }

  if (postType === 2) {
    const imageData = parseImageSection(content);
    const parsed = [imageData.title, imageData.takeaway].filter(Boolean).join('\n\n');
    const text = parsed || content;
    return { text, imageData };
  }

  // postType === 3
  const textMatch = content.match(/TEXT:\s*\n([\s\S]+?)(?=\n\s*IMAGE:|$)/i);
  const imageMatch = content.match(/IMAGE:\s*\n([\s\S]+)/i);
  const text = (textMatch ? textMatch[1].trim() : '') || content;
  const imageData = imageMatch ? parseImageSection(imageMatch[1]) : null;
  return { text, imageData };
}

function nextPostType(current) {
  if (current === 1) return 2;
  if (current === 2) return 3;
  return 1;
}

// ── Gemini Content Generation ─────────────────────────────────────────────────

async function generateContent(postType, role, skills, topic) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const angle = POST_ANGLES[Math.floor(Math.random() * POST_ANGLES.length)];
  let prompt;
  if (postType === 1) prompt = buildTextPrompt(role, skills, topic, angle);
  else if (postType === 2) prompt = buildImagePrompt(role, topic, angle);
  else prompt = buildCombinedPrompt(role, skills, topic, angle);

  const GEMINI_MODELS = [
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b',
  ];

  let lastErr;
  let hitRateLimit = false;
  for (const modelName of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
        }),
        signal: AbortSignal.timeout(30000),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = data?.error?.message || `Gemini HTTP ${res.status}`;
        console.error(`[automation] Gemini ${res.status} for ${modelName}:`, errMsg);
        if (res.status === 429) {
          hitRateLimit = true;
          const isDaily = errMsg.toLowerCase().includes('day') || errMsg.toLowerCase().includes('daily') || errMsg.toLowerCase().includes('quota');
          lastErr = new Error(
            isDaily
              ? 'Gemini daily quota exhausted. Please try again tomorrow or upgrade your API key at aistudio.google.com.'
              : 'AI rate limit hit. Please wait a minute and try again.'
          );
          continue;
        }
        if (res.status === 400 || res.status === 403) {
          throw new Error(`Gemini API error: ${errMsg}`);
        }
        lastErr = new Error(errMsg);
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) {
        lastErr = new Error('Empty response from Gemini');
        continue;
      }

      console.log(`[automation] SUCCESS with Gemini model: ${modelName}`);
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API error') || msg.includes('[403]') || msg.includes('[400]')) throw err;
      lastErr = err;
    }
  }

  if (hitRateLimit) throw lastErr || new Error('AI rate limit hit. Please wait a minute and try again.');
  throw lastErr || new Error('All Gemini models failed');
}

// ── LinkedIn Post Publisher ───────────────────────────────────────────────────

async function getLinkedInPersonId(accessToken) {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkedIn userinfo ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const sub = data.sub || '';
  if (!sub) throw new Error('LinkedIn userinfo returned no sub claim');
  return sub;
}

async function publishToLinkedIn(accessToken, personId, text) {
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${personId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkedIn ugcPosts ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const postId = data.id || '';
  const postUrl = postId
    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}/`
    : '';
  return { postId, postUrl };
}

// ── Main export ───────────────────────────────────────────────────────────────

async function runAutomation(userId) {
  if (!userId) return { success: false, error: 'user_id is required' };
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { success: false, error: 'Server configuration error' };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('role, skills, topics, linkedin_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr || !profile) return { success: false, error: 'Profile not found' };
  if (!profile.linkedin_token) return { success: false, error: 'LinkedIn is not connected' };

  const role = typeof profile.role === 'string' ? profile.role.trim() : 'Professional';
  const skills = parseList(profile.skills);
  const topics = parseList(profile.topics);
  if (topics.length === 0) return { success: false, error: 'No topics configured in profile' };

  const { data: rotation } = await admin
    .from('automation_rotation')
    .select('current_step, post_type')
    .eq('user_id', userId)
    .maybeSingle();

  const currentStep = rotation?.current_step ?? 1;
  const postType = rotation?.post_type ?? 1;
  const topicIndex = (currentStep - 1) % topics.length;
  const topic = topics[topicIndex];
  const nextStep = (currentStep % topics.length) + 1;
  const nextType = nextPostType(postType);

  let rawContent;
  try {
    rawContent = await generateContent(postType, role, skills, topic);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Content generation failed';
    return { success: false, error: msg };
  }

  const { text } = parsePostContent(postType, rawContent);

  if (!text || text.trim().length < 10) {
    return { success: false, error: `Gemini returned unusable content. Raw: ${rawContent?.slice(0, 100)}` };
  }

  let personId, postId, postUrl;
  try {
    personId = await getLinkedInPersonId(profile.linkedin_token);
    ({ postId, postUrl } = await publishToLinkedIn(profile.linkedin_token, personId, text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LinkedIn publish failed';
    return { success: false, error: msg };
  }

  await admin.from('posts').insert({
    user_id: userId,
    content: text,
    status: 'published',
    post_id: postId,
    post_url: postUrl,
    posted_at: new Date().toISOString(),
    topic,
    post_type: postType,
  });

  await admin.from('automation_rotation').upsert(
    { user_id: userId, current_step: nextStep, post_type: nextType },
    { onConflict: 'user_id' }
  );

  console.log(`[automation] user=${userId} post_type=${postType} topic="${topic}" post_id=${postId}`);
  return { success: true, topic, post_type: postType, post_id: postId, post_url: postUrl };
}

module.exports = { runAutomation };
