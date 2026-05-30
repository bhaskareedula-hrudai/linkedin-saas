const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { sessionId, userId } = req.body;
    if (!sessionId || !userId) {
      return res.status(400).json({ error: 'Missing sessionId or userId' });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid' || session.status === 'complete') {
      const supabase = getAdminSupabase();
      await supabase.from('profiles').update({
        subscription_status: 'active',
        selected_plan: session.metadata?.plan_id ?? 'starter',
        stripe_subscription_id: session.subscription ?? null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId);

      return res.status(200).json({ status: 'active', planId: session.metadata?.plan_id });
    }

    return res.status(200).json({ status: session.payment_status ?? 'unpaid' });
  } catch (err) {
    console.error('Verify session error:', err);
    return res.status(500).json({ error: err.message ?? 'Verification failed' });
  }
};