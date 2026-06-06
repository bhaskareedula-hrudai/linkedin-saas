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
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    const supabase = getAdminSupabase();
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    const customerId = profile?.stripe_customer_id ?? undefined;
    if (!customerId) {
      return res.status(404).json({ error: 'No billing account found for this user' });
    }

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ??
      req.headers.origin ??
      'https://linkedin-saas-zwfq.vercel.app'
    ).replace(/\/$/, '');

    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/app/settings`,
    });

    return res.status(200).json({ url: portal.url });
  } catch (err) {
    console.error('Stripe portal error:', err);
    return res.status(500).json({ error: err.message ?? 'Portal session failed' });
  }
};