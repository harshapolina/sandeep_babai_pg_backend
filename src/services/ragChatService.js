const { KnowledgeChunk, Organization } = require('../models');
const { tokenize } = require('./ragIndexService');

const STOP = new Set([
  'the', 'and', 'for', 'are', 'how', 'what', 'where', 'when', 'why', 'who',
  'can', 'you', 'our', 'does', 'did', 'have', 'has', 'was', 'were', 'with',
  'from', 'this', 'that', 'into', 'about', 'please', 'tell', 'me', 'any',
  'all', 'some', 'there', 'their', 'they', 'them', 'your', 'mine', 'just',
]);

function queryTokens(question) {
  return tokenize(question).filter((t) => !STOP.has(t) && t.length > 2);
}

function scoreChunk(tokens, chunk) {
  if (!tokens.length) return 0;
  const title = String(chunk.title || '').toLowerCase();
  const content = String(chunk.content || '').toLowerCase();
  const keywords = (chunk.keywords || []).map((k) => String(k).toLowerCase());
  let score = 0;
  for (const t of tokens) {
    if (title.split(/\s+/).includes(t) || title.includes(t)) score += 3;
    if (keywords.some((k) => k === t || k.includes(t))) score += 2;
    if (content.includes(t)) score += 1;
  }
  // Prefer shorter, focused help docs slightly less than exact data hits
  if (chunk.sourceType === 'help') score *= 0.95;
  return score / Math.max(tokens.length, 1);
}

function intentBoost(question, chunk) {
  const q = question.toLowerCase();
  const title = String(chunk.title || '').toLowerCase();
  const content = String(chunk.content || '').toLowerCase();
  const type = chunk.sourceType;
  let boost = 0;
  if (/(register|registration|apply|application)/.test(q) && (type === 'registration' || title.includes('registration')))
    boost += 3;
  if (/(smtp|app password|gmail)/.test(q) && (content.includes('smtp') || title.includes('email')))
    boost += 4;
  else if (/(email|mail|announcement|notice)/.test(q) && (type === 'announcement' || /email|smtp|announcement/.test(title)))
    boost += 2.5;
  if (/(rent due|due day|payment|mark.*paid)/.test(q) && (type === 'payment_policy' || /payment|rent/.test(title)))
    boost += 3;
  if (/(ticket|maintenance|repair|plumbing)/.test(q) && (type === 'ticket' || /ticket|maintenance/.test(title)))
    boost += 3;
  if (/(how many|count|overview|stats|snapshot|free bed)/.test(q) && type === 'stats') boost += 3.5;
  else if (/(room|bed|floor|occupancy|vacant)/.test(q) && (type === 'room' || type === 'stats' || type === 'property'))
    boost += 2;
  if (/(tenant|resident|who lives)/.test(q) && type === 'tenant') boost += 3;
  if (/(app name|currency|timezone)/.test(q) && (type === 'organization' || title.includes('settings')))
    boost += 2;
  // Prefer dedicated how-to over generic settings overview when both match
  if (title.includes('settings overview') && !/settings overview|what.*settings/.test(q)) boost -= 1.5;
  return boost;
}

async function retrieveChunks({ organizationId, question, isAdmin, limit = 3 }) {
  const audience = isAdmin ? { $in: ['all', 'admin'] } : { $in: ['all', 'tenant'] };
  const tokens = queryTokens(question);

  const pool = await KnowledgeChunk.find({ organization: organizationId, audience })
    .select('title content sourceType keywords')
    .limit(400)
    .lean();

  const ranked = pool
    .map((c) => {
      const base = scoreChunk(tokens, c);
      const boost = intentBoost(question, c);
      return { ...c, rank: base + boost };
    })
    .filter((c) => c.rank >= 0.85)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);

  // If nothing strong matched, try softer threshold with fewer results
  if (!ranked.length && tokens.length) {
    return pool
      .map((c) => ({ ...c, rank: scoreChunk(tokens, c) + intentBoost(question, c) }))
      .filter((c) => c.rank > 0.35)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 1);
  }

  return ranked;
}

function pickSentences(text, tokens, maxSentences = 2) {
  const normalized = String(text)
    .replace(/\s+/g, ' ')
    .replace(/\be\.g\./gi, 'eg')
    .replace(/\bi\.e\./gi, 'ie');

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/\beg\b/gi, 'e.g.').replace(/\bie\b/gi, 'i.e.'))
    .filter((s) => s.length > 25);

  if (!sentences.length) {
    const raw = String(text).replace(/\s+/g, ' ').trim();
    return raw.length > 240 ? `${raw.slice(0, 237)}…` : raw;
  }

  const scored = sentences.map((s, idx) => {
    const lower = s.toLowerCase();
    let hits = 0;
    for (const t of tokens) if (lower.includes(t)) hits += 1;
    // Prefer earlier sentences slightly when tie
    return { s, hits, idx, len: s.length };
  });

  scored.sort((a, b) => b.hits - a.hits || a.idx - b.idx);
  const chosen = scored.filter((x) => x.hits > 0).slice(0, maxSentences);
  const out = (chosen.length ? chosen : scored.slice(0, 1))
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.s);
  let joined = out.join(' ').trim();
  if (joined.length > 280) joined = `${joined.slice(0, 277).trim()}…`;
  return joined;
}

function buildLocalAnswer(question, chunks, appName) {
  if (!chunks.length) {
    return `I don’t have a clear match for that in ${appName} yet. Try a more specific question (like “how do payments work?”), or tap Reindex in Settings ? AI Chatbot.`;
  }

  const tokens = queryTokens(question);
  // Always one focused chunk — avoids the same long dump for every ask
  let answer = pickSentences(chunks[0].content, tokens, 2);
  if (answer && !/[.!?…]$/.test(answer)) answer += '.';
  return answer.trim();
}

async function callGemini({ apiKey, model, system, prompt }) {
  const m = model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${system}\n\n${prompt}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

async function callOpenAI({ apiKey, model, system, prompt }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function answerQuestion({ organizationId, question, isAdmin, userName }) {
  const org = await Organization.findById(organizationId).select('+settings.chatbot.apiKey');
  if (!org) throw new Error('Organization not found');

  const bot = org.settings?.chatbot || {};
  if (bot.enabled === false) {
    return {
      answer: 'The assistant is turned off in Settings ? AI Chatbot.',
      sources: [],
      mode: 'disabled',
    };
  }

  const appName = org.settings?.appName || org.name || 'Has Tracker';
  const chunks = await retrieveChunks({ organizationId, question, isAdmin, limit: 3 });
  const context = chunks
    .map((c, i) => `[${i + 1}] (${c.sourceType}) ${c.title}\n${c.content}`)
    .join('\n\n');

  const system = `You are the in-app assistant for ${appName}.
Rules:
- Answer ONLY the user's question in 1–3 short sentences.
- Do NOT dump long lists or repeat unrelated facts.
- Use only the CONTEXT. If context is weak, say you are not sure.
- No passwords, SMTP secrets, or invented PII.
Role: ${isAdmin ? 'staff/admin' : 'tenant'}. Name: ${userName || 'there'}.`;

  const prompt = `QUESTION:\n${question}\n\nCONTEXT:\n${context || '(none)'}\n\nWrite a short direct answer:`;

  const providerPref = bot.provider || 'auto';
  let mode = 'local';
  let answer = '';

  try {
    if (providerPref === 'gemini' || (providerPref === 'auto' && (process.env.GEMINI_API_KEY || (bot.apiKey && !String(bot.apiKey).startsWith('sk-'))))) {
      const key = process.env.GEMINI_API_KEY || bot.apiKey;
      if (key && providerPref !== 'openai' && providerPref !== 'local') {
        answer = await callGemini({ apiKey: key, model: bot.model, system, prompt });
        mode = 'gemini';
      }
    }
    if (!answer && (providerPref === 'openai' || (providerPref === 'auto' && (process.env.OPENAI_API_KEY || (bot.apiKey && String(bot.apiKey).startsWith('sk-')))))) {
      const key = process.env.OPENAI_API_KEY || bot.apiKey;
      if (key && providerPref !== 'gemini' && providerPref !== 'local') {
        answer = await callOpenAI({ apiKey: key, model: bot.model, system, prompt });
        mode = 'openai';
      }
    }
  } catch (err) {
    console.warn('LLM answer failed, falling back to local RAG:', err.message);
  }

  if (!answer) {
    answer = buildLocalAnswer(question, chunks, appName);
    mode = 'local';
  }

  // Hard cap length so UI never gets a wall of text
  answer = String(answer).trim().replace(/\n{3,}/g, '\n\n');
  if (answer.length > 500) answer = `${answer.slice(0, 497).trim()}…`;

  return {
    answer,
    mode,
    sources: chunks.slice(0, 2).map((c) => ({
      title: c.title,
      sourceType: c.sourceType,
    })),
  };
}

module.exports = { answerQuestion, retrieveChunks };
