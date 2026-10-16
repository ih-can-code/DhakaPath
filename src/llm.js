// Free-tier LLM connectors: Gemini (AI Studio), Groq, or a local Ollama. Optional: the app works without any key.
// The model only turns text into structured data or rewrites verified facts. It never creates routes or fares.
const nlp = require('./nlp');

const TIMEOUT_MS = 9000;
const status = { provider: null, lastError: null, calls: 0, model: null };

// Free Gemini models change often and can be busy, so try a short list and remember the one that answered.
const GEMINI_MODELS = () => [...new Set([process.env.GEMINI_MODEL, status.model, 'gemini-flash-lite-latest', 'gemini-flash-latest'].filter(Boolean))];
async function gemini(body) {
  let lastErr = null;
  for (const model of GEMINI_MODELS()) {
    try {
      const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, body);
      status.model = model;
      return j;
    } catch (e) {
      lastErr = e;
      if (!/^(404|429|500|503)/.test(e.message) && e.name !== 'AbortError') break; // only move on for busy or retired models
    }
  }
  throw lastErr || new Error('No Gemini model answered');
}

function provider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OLLAMA_MODEL || process.env.OLLAMA_URL) return 'ollama';
  return null;
}

async function post(url, body, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function complete(system, user, { json = true } = {}) {
  const p = provider();
  status.provider = p;
  if (!p) return null;
  status.calls++;
  try {
    if (p === 'gemini') {
      const j = await gemini({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1, responseMimeType: json ? 'application/json' : 'text/plain' },
      });
      return j.candidates?.[0]?.content?.parts?.map(x => x.text).join('') || null;
    }
    if (p === 'groq') {
      const j = await post('https://api.groq.com/openai/v1/chat/completions', {
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', temperature: 0.1,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }, { authorization: `Bearer ${process.env.GROQ_API_KEY}` });
      return j.choices?.[0]?.message?.content || null;
    }
    const base = process.env.OLLAMA_URL || 'http://localhost:11434';
    const j = await post(`${base}/api/chat`, {
      model: process.env.OLLAMA_MODEL || 'llama3.2', stream: false, ...(json ? { format: 'json' } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    return j.message?.content || null;
  } catch (e) {
    status.lastError = e.message;
    return null;
  }
}

function extractJSON(text) {
  if (!text) return null;
  const clean = text.replace(/```json|```/gi, '').trim();
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(clean.slice(a, b + 1)); } catch { return null; }
}

// Turn a commuter message into structured intent. Output is grounded against real hub ids by the caller.
async function understand(text, hubs, context) {
  const names = hubs.map(h => `${h.id} (${h.name})`).join(', ');
  const system =
    'You convert Dhaka commuter messages (English or Banglish) into JSON. Reply with JSON only, no prose. ' +
    `Valid hub ids: ${names}. Use null when unsure. Never invent hub ids. ` +
    'Schema: {"intent":"route|report|reroute|fare_question|reliability|greeting|other","from":hubId|null,"to":hubId|null,"avoid":[hubId],' +
    '"budget":number|null,"student":boolean|null,"arriveBy":"HH:MM"|null,"alertType":"waterlogging|construction|gridlock|blockade"|null,' +
    '"hub":hubId|null,"severity":1|2|3|null,"topic":"student|floor|surge|metro"|null}. ' +
    'Banglish examples: "Mirpur theke Motijheel 80 takar moddhe" = from mirpur to motijheel budget 80. "Farmgate avoid kore" = avoid farmgate.';
  const raw = await complete(system, `Context: ${JSON.stringify(context || {})}\nMessage: ${text}`);
  const j = extractJSON(raw);
  if (!j) return null;
  const dropped = [];
  const hub = k => { if (j[k] == null) return null; const id = nlp.resolveHub(j[k], hubs); if (!id) dropped.push(`${k}: "${j[k]}" is not a known hub`); return id; };
  const out = {
    intent: ['route', 'report', 'reroute', 'fare_question', 'reliability', 'greeting', 'other'].includes(j.intent) ? j.intent : null,
    from: hub('from'), to: hub('to'), hub: hub('hub'),
    avoid: (Array.isArray(j.avoid) ? j.avoid : []).map(a => { const id = nlp.resolveHub(a, hubs); if (!id) dropped.push(`avoid: "${a}" is not a known hub`); return id; }).filter(Boolean),
    budget: Number.isFinite(Number(j.budget)) && Number(j.budget) > 0 ? Number(j.budget) : null,
    student: typeof j.student === 'boolean' ? j.student : null,
    arriveBy: null,
    alertType: ['waterlogging', 'construction', 'gridlock', 'blockade'].includes(j.alertType) ? j.alertType : null,
    severity: [1, 2, 3].includes(Number(j.severity)) ? Number(j.severity) : null,
    topic: ['student', 'floor', 'surge', 'metro'].includes(j.topic) ? j.topic : null,
    dropped,
  };
  const m = typeof j.arriveBy === 'string' && j.arriveBy.match(/^(\d{1,2}):(\d{2})$/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) out.arriveBy = Number(m[1]) * 60 + Number(m[2]);
  return out;
}

// Rewrite verified facts as a short answer in the user's language style. Caller must ground-check the result.
async function answer(question, facts, lang) {
  const system =
    'You are the DhakaPath commute assistant. Answer ONLY from the facts given. Do not add routes, bus names, places, fares or times that are not in the facts. ' +
    `Keep it under 70 words. Reply in ${lang === 'bn' ? 'Banglish (Bangla written in English letters)' : 'English'}. Plain text only.`;
  return complete(system, `Facts:\n${facts}\n\nQuestion: ${question}`, { json: false });
}

// Read a signboard / fare chart photo. Gemini only. Returns { routes: [{name, stops[], fare, notes}] } or null.
async function vision(base64, mime) {
  if (!process.env.GEMINI_API_KEY) return null;
  status.calls++;
  try {
    const j = await gemini({
      contents: [{ role: 'user', parts: [
        { text: 'This is a photo of a Dhaka bus signboard, printed fare chart, or handwritten route note (Bangla or English). Extract the routes. Reply with JSON only: {"routes":[{"name":string,"stops":[string in travel order],"fare":number|null,"notes":string}]}. Write place names in English letters. If unreadable, return {"routes":[]}.' },
        { inline_data: { mime_type: mime || 'image/jpeg', data: base64 } },
      ] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });
    return extractJSON(j.candidates?.[0]?.content?.parts?.map(x => x.text).join(''));
  } catch (e) { status.lastError = e.message; return null; }
}

// Resolve to null if the AI has not answered in time, so the app never waits on a busy free model.
function withDeadline(promise, ms) {
  return Promise.race([promise.catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
}

module.exports = { provider, status, complete, understand, answer, vision, extractJSON, withDeadline };
