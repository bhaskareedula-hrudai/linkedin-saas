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

const STRIPE_PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER ?? '',
  professional: process.env.STRIPE_PRICE_PROFESSIONAL ?? '',
  'brand-pro': process.env.STRIPE_PRICE_BRAND_PRO ?? '',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { planId, userId, email } = req.body;
    if (!planId || !userId || !email) {
      return res.status(400).json({ error: 'Missing planId, userId, or email' });
    }
    const priceId = STRIPE_PRICE_IDS[planId];
    if (!priceId) {
      return res.status(400).json({ error: `No Stripe price configured for plan "${planId}"` });
    }
    const stripe = getStripe();
    const supabase = getAdminSupabase();
    const { data: profile } = await supabase
      .from('profiles').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
    let customerId = profile?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { supabase_user_id: userId } });
      customerId = customer.id;
      await supabase.from('profiles')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.headers.origin ?? 'https://linkedin-saas-zwfq.vercel.app';

    // Route to profile setup on first payment, dashboard if profile already complete
     
// ADD this block before the session creation:
const { data: profileData } = await supabase
  .from('profiles')
  .select('onboarding_completed')
  .eq('user_id', userId)
  .maybeSingle();
const profileComplete = profileData?.onboarding_completed === true;
const successPath = profileComplete ? '/#/app/dashboard' : '/#/app/profile-setup';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/#/checkout/${planId}`,
      metadata: { supabase_user_id: userId, plan_id: planId },
      subscription_data: { metadata: { supabase_user_id: userId, plan_id: planId } },
      allow_promotion_codes: true,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message ?? 'Checkout failed' });
  }
};