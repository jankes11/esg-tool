export const config = { runtime: 'edge' };

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

  const { email } = body;

  try {
    const params = new URLSearchParams({
      'mode': 'payment',
      'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][product_data][name]': 'ESG Assessment Report PDF',
      'line_items[0][price_data][product_data][description]': '8-page branded ESG report with AI recommendations, ESRS/VSME alignment, and action plan',
      'line_items[0][price_data][unit_amount]': '1900',
      'line_items[0][quantity]': '1',
      'success_url': 'https://myesgcheck.com/?session_id={CHECKOUT_SESSION_ID}',
      'cancel_url': 'https://myesgcheck.com/',
      'payment_method_types[0]': 'card',
    });

    // Pre-fill email if provided
    if (email && email.includes('@')) {
      params.append('customer_email', email);
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.text();
      console.error('Stripe create session error:', err);
      return new Response(
        JSON.stringify({ error: 'stripe_error' }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    const session = await stripeRes.json();

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
    );

  } catch (err) {
    console.error('create-checkout error:', err);
    return new Response(
      JSON.stringify({ error: 'server_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  }
}
