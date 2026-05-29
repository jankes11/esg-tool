export const config = { runtime: 'edge' };

const tokenStore = new Map();

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

  const { action, email, token } = body;

  /* ── verify by email ──────────────────────────────────── */
  if (action === 'verify_email') {
    if (!email || !email.includes('@')) {
      return new Response(
        JSON.stringify({ error: 'invalid_email', valid: false }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    try {
      // Search Stripe for recent paid sessions for this email
      // Look back 24 hours
      const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

      const stripeRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions?customer_details[email]=${encodeURIComponent(email)}&status=complete&limit=5&created[gte]=${since}`,
        { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
      );

      if (!stripeRes.ok) {
        const err = await stripeRes.text();
        console.error('Stripe error:', err);
        return new Response(
          JSON.stringify({ error: 'stripe_error', valid: false }),
          { status: 502, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      const data = await stripeRes.json();
      const sessions = data.data || [];

      // Find a paid session for our product
      const paidSession = sessions.find(s =>
        s.payment_status === 'paid' &&
        s.amount_total >= 1900 // £19.00 in pence
      );

      if (!paidSession) {
        return new Response(
          JSON.stringify({ error: 'no_paid_session', valid: false }),
          { status: 402, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      // Check this session hasn't already been used for a download
      const usedKey = 'used_' + paidSession.id;
      if (tokenStore.get(usedKey)) {
        return new Response(
          JSON.stringify({ error: 'already_used', valid: false }),
          { status: 409, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      // Generate download token
      const downloadToken = crypto.randomUUID();
      tokenStore.set(downloadToken, {
        sessionId: paidSession.id,
        email,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
        used: false
      });

      // Clean expired tokens
      for (const [k, v] of tokenStore) {
        if (k.startsWith('used_')) continue;
        if (Date.now() > v.expiresAt) tokenStore.delete(k);
      }

      return new Response(
        JSON.stringify({ valid: true, token: downloadToken }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
      );

    } catch (err) {
      console.error('verify_email error:', err);
      return new Response(
        JSON.stringify({ error: 'server_error', valid: false }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
  }

  /* ── redeem token ─────────────────────────────────────── */
  if (action === 'redeem') {
    if (!token) return new Response(
      JSON.stringify({ error: 'missing_token', valid: false }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
    );

    const entry = tokenStore.get(token);
    if (!entry) return new Response(
      JSON.stringify({ error: 'invalid_token', valid: false }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } }
    );

    if (Date.now() > entry.expiresAt) {
      tokenStore.delete(token);
      return new Response(
        JSON.stringify({ error: 'token_expired', valid: false }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    if (entry.used) return new Response(
      JSON.stringify({ error: 'token_used', valid: false }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } }
    );

    entry.used = true;
    tokenStore.set(token, entry);
    // Mark session as used
    tokenStore.set('used_' + entry.sessionId, true);

    return new Response(
      JSON.stringify({ valid: true }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  }

  return new Response('Unknown action', { status: 400 });
}
