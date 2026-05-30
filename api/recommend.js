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

// Industry-specific guidance context for the prompt
function getIndustryContext(industry) {
  const ind = (industry || '').toLowerCase();
  if (ind.includes('construct') || ind.includes('build') || ind.includes('civil')) {
    return `Industry-specific context for Construction:
- Key carbon sources: diesel plant/machinery, concrete, steel, aggregates, timber, transport
- Relevant frameworks: PAS 2080 (carbon in buildings), BREEAM, Considerate Constructors Scheme
- Supply chain priorities: Environmental Product Declarations (EPDs) for materials, sustainably sourced timber (FSC/PEFC), Modern Slavery in subcontractor chains
- Site-level actions: skip hire waste tracking, fuel consumption logs, dust and noise records
- Customer/tender requirements: ISO 14001, SSIP (H&S), PQQ/SQ ESG sections, net-zero supply chain clauses`;
  }
  if (ind.includes('retail') || ind.includes('food') || ind.includes('hospitality')) {
    return `Industry-specific context for Retail/Food/Hospitality:
- Key carbon sources: refrigeration, packaging, food waste, logistics, store energy
- Relevant frameworks: Wrap (food waste), Courtauld Commitment, Sedex (supply chain)
- Supply chain priorities: food provenance, packaging recyclability, supplier labour standards
- Customer requirements: B Corp alignment, plastic reduction commitments, Fair Trade`;
  }
  if (ind.includes('manufactur') || ind.includes('engineering')) {
    return `Industry-specific context for Manufacturing/Engineering:
- Key carbon sources: process energy, raw materials, logistics, product end-of-life
- Relevant frameworks: ISO 14001, ISO 50001 (energy), GHG Protocol product standard
- Supply chain priorities: conflict minerals, EPDs, supplier carbon data
- Customer requirements: REACH compliance, RoHS, supply chain due diligence`;
  }
  if (ind.includes('tech') || ind.includes('software') || ind.includes('digital') || ind.includes('it')) {
    return `Industry-specific context for Technology/Software:
- Key carbon sources: data centres, cloud computing, business travel, employee commuting
- Relevant frameworks: GHG Protocol, Science Based Targets (SBTi)
- Supply chain priorities: hardware supply chains, conflict minerals in devices
- Customer requirements: ISO 27001 (data), supplier ESG questionnaires in enterprise sales`;
  }
  if (ind.includes('transport') || ind.includes('logistics') || ind.includes('fleet')) {
    return `Industry-specific context for Transport/Logistics:
- Key carbon sources: fleet fuel (Scope 1), contracted haulage (Scope 3)
- Relevant frameworks: GLEC Framework, Clean Vehicle Directive
- Supply chain priorities: subcontractor emissions, EV transition planning
- Customer requirements: fleet carbon reporting, route optimisation evidence`;
  }
  // Default generic context
  return `Focus recommendations on the specific gaps identified. Use plain English and name real free tools where helpful (e.g. GHG Protocol, ICO GDPR guide, gov.uk guidance).`;
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
  const industryContext = getIndustryContext(industry);

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

${industryContext}

The category scores above show where this business is weakest. Focus your recommendations on the lowest-scoring categories first — not just on climate or environment if those are not the weakest areas.

Write a short, practical improvement plan. Three sections:

## Quick wins (next 1–3 months)
2–3 specific, concrete actions targeting their actual gaps. Prioritise actions in the lowest-scoring category. Use industry-specific tools, frameworks or terminology where relevant. Do NOT suggest vague actions — be specific to their industry and gaps.

## Bigger priorities (next 6–12 months)
2–3 medium-term actions realistic for a ${size || 'small'} business in ${industry || 'their sector'}.

## What mature ESG programmes typically include
1–2 sentences describing practices commonly seen in organisations with well-developed ESG programmes in this sector — framed as observable practices, not invented statistics.

RULES:
- Do not invent benchmark scores, sector averages, or percentage comparisons
- Do not suggest specific year targets (e.g. "net zero by 2040") — suggest "set a measurable target" instead
- Do not use phrases like "top performers", "industry leaders", "sector average"
- Be specific to the industry — generic advice is less useful than sector-specific guidance
- Prioritise the lowest-scoring category — if Supply Chain scores 43%, include at least one specific supply chain action
- Do not default to climate/environment if other categories score lower
- Use a GRADUATED approach to maturity: start with basic foundations (e.g. supplier code of conduct, ESG questionnaire) before suggesting advanced standards (EPDs, PAS 2080, ISO 14001)
- For construction firms at <50%: start with supplier code of conduct and basic screening; suggest EPDs and PAS 2080 only as medium-term priorities
- For PAS 2080: say "use PAS 2080 principles" not specific section numbers — too technical for small firms
- Suggest concrete KPIs where helpful: e.g. "aim to screen 80% of suppliers by spend" or "target 15% diesel reduction on site"
- Keep under 280 words. Be direct, practical, encouraging.
- MANDATORY COVERAGE: For every category with score < 50%, generate at least 1 specific recommendation.
  Categories below 50% must each appear in Quick wins or Bigger priorities.
- MANDATORY COVERAGE: For categories between 50-59%, include at least 1 recommendation in Bigger priorities.
- Do NOT focus only on supply chain and carbon if other gaps exist (e.g. lifecycle impact, biodiversity, customer transparency, workforce monitoring).
- Spread recommendations across ALL gap areas, not just the lowest scoring category.`;

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
        max_tokens: 650,
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
