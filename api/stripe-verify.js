export const config = { runtime: 'edge' };

// Verified session IDs — prevents reuse
const usedSessions = new Set();

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { sessionId } = body;

  if (!sessionId || !sessionId.startsWith('cs_')) {
    return new Response(
      JSON.stringify({ error: 'invalid_session', valid: false }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  }

  // Check already used
  if (usedSessions.has(sessionId)) {
    return new Response(
      JSON.stringify({ error: 'already_used', valid: false }),
      { status: 409, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  }

  try {
    // Verify directly with Stripe
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
    );

    if (!stripeRes.ok) {
      return new Response(
        JSON.stringify({ error: 'stripe_error', valid: false }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    const session = await stripeRes.json();

    // Must be paid
    if (session.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({ error: 'not_paid', valid: false }),
        { status: 402, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // Must be correct amount (£19 = 1900 pence)
    if (session.amount_total < 1900) {
      return new Response(
        JSON.stringify({ error: 'wrong_amount', valid: false }),
        { status: 402, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // Mark as used — prevents re-downloading without paying again
    usedSessions.add(sessionId);

    // Clean up set if it gets large (keep last 1000)
    if (usedSessions.size > 1000) {
      const first = usedSessions.values().next().value;
      usedSessions.delete(first);
    }

    return new Response(
      JSON.stringify({ valid: true, email: session.customer_details?.email || '' }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
    );

  } catch (err) {
    console.error('stripe-verify error:', err);
    return new Response(
      JSON.stringify({ error: 'server_error', valid: false }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  }
}
