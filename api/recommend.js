export const config = { runtime: 'edge' };

const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000;
const MAX_REQUESTS = 3;
const store = new Map();

function getIP(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         req.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = store.get(ip) || { count: 0, reset: now + RATE_LIMIT_WINDOW };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + RATE_LIMIT_WINDOW;
  }
  if (entry.count >= MAX_REQUESTS) return false;
  entry.count++;
  store.set(ip, entry);
  return true;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const ip = getIP(req);
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', message: 'You have reached the limit of 3 free AI recommendations per day. Please try again tomorrow.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { co, industry, size, overall, catSummary, gapList, partialList } = body;

  const prompt = `You are a plain-speaking ESG consultant helping a small or medium business improve its sustainability.

Company: ${co || 'Not specified'}
Industry: ${industry || 'Not specified'}
Size: ${size || 'Not specified'}
Overall ESG score: ${overall}%
Category scores: ${catSummary}

Gaps (answered No):
${gapList || 'None identified'}

In progress (answered Partial):
${partialList || 'None identified'}

Write a short, practical improvement plan using plain English — no jargon. Three sections:

1. Quick wins (next 1–3 months)
2–3 specific, concrete actions that target their actual gaps. Name real tools or frameworks if helpful (e.g. GHG Protocol, ISO 14001). Do NOT suggest specific percentage targets or year-based deadlines.

2. Bigger priorities (next 6–12 months)
2–3 medium-term actions. Keep them realistic for a ${size || 'small'} business in ${industry || 'their sector'}.

3. What stronger performers typically do
1–2 sentences describing the practices that organisations with stronger ESG performance typically have in place — without inventing benchmark scores, sector averages, or year targets.

IMPORTANT: Do not invent benchmark numbers, sector averages, percentage comparisons, or year-based targets (e.g. "2035", "2040", "60-70%", "top quartile"). Stick to observable practices.

Keep the whole response under 220 words. Be direct and encouraging — not preachy.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return new Response(
        JSON.stringify({ error: 'api_error', message: 'AI service temporarily unavailable.' }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '';

    return new Response(
      JSON.stringify({ text }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );

  } catch (err) {
    console.error('Handler error:', err);
    return new Response(
      JSON.stringify({ error: 'server_error', message: 'Something went wrong.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
