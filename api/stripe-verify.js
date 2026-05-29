export const config = { runtime: 'edge' };

// In-memory token store (persists per edge instance, ~hours)
// For production: replace with KV store (Vercel KV / Upstash Redis)
const validTokens = new Map();

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { action, sessionId, token } = body;

  /* ── ACTION: verify Stripe session ─────────────────────── */
  if (action === 'verify') {
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'missing_session' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    try {
      // Verify with Stripe API
      const stripeRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          }
        }
      );

      if (!stripeRes.ok) {
        return new Response(
          JSON.stringify({ error: 'stripe_error', valid: false }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      const session = await stripeRes.json();

      // Check payment is actually completed
      if (session.payment_status !== 'paid') {
        return new Response(
          JSON.stringify({ error: 'not_paid', valid: false }),
          { status: 402, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Generate a one-time use token
      const downloadToken = crypto.randomUUID();
      const expiresAt = Date.now() + (2 * 60 * 60 * 1000); // 2 hours

      validTokens.set(downloadToken, {
        sessionId,
        email: session.customer_details?.email || '',
        expiresAt,
        used: false
      });

      // Clean up old tokens (keep map small)
      for (const [k, v] of validTokens) {
        if (Date.now() > v.expiresAt) validTokens.delete(k);
      }

      return new Response(
        JSON.stringify({ valid: true, token: downloadToken, email: session.customer_details?.email || '' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );

    } catch (err) {
      console.error('Stripe verify error:', err);
      return new Response(
        JSON.stringify({ error: 'server_error', valid: false }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  /* ── ACTION: redeem token ───────────────────────────────── */
  if (action === 'redeem') {
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'missing_token', valid: false }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const entry = validTokens.get(token);

    if (!entry) {
      return new Response(
        JSON.stringify({ error: 'invalid_token', valid: false }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    if (Date.now() > entry.expiresAt) {
      validTokens.delete(token);
      return new Response(
        JSON.stringify({ error: 'token_expired', valid: false }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    if (entry.used) {
      return new Response(
        JSON.stringify({ error: 'token_used', valid: false }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Mark as used (single-use token)
    entry.used = true;
    validTokens.set(token, entry);

    return new Response(
      JSON.stringify({ valid: true, email: entry.email }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  return new Response('Unknown action', { status: 400 });
}
