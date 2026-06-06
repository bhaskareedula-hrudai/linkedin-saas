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

async function updateProfile(userId, updates) {
  const supabase = getAdminSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) console.error('updateProfile error:', error);
}

async function userIdFromCustomer(customerId) {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'] ?? '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const planId = session.metadata?.plan_id;
        if (!userId) break;
        await updateProfile(userId, {
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          subscription_status: 'active',
          selected_plan: planId ?? null,
        });
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;
        // Map price ID → plan name so selected_plan updates on upgrade/downgrade
        const priceId = sub.items?.data?.[0]?.price?.id;
        const PRICE_TO_PLAN = {
          [process.env.STRIPE_PRICE_STARTER || '']: 'starter',
          [process.env.STRIPE_PRICE_PROFESSIONAL || '']: 'professional',
          [process.env.STRIPE_PRICE_BRAND_PRO || '']: 'brand-pro',
        };
        const newPlan = priceId ? PRICE_TO_PLAN[priceId] : undefined;
        await updateProfile(userId, {
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          ...(newPlan ? { selected_plan: newPlan } : {}),
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;
        await updateProfile(userId, {
          stripe_subscription_id: null,
          subscription_status: 'canceled',
          selected_plan: 'starter',
        });
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const userId = await userIdFromCustomer(invoice.customer);
        if (!userId) break;
        await updateProfile(userId, { subscription_status: 'past_due' });
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        const userId = await userIdFromCustomer(invoice.customer);
        if (!userId) break;
        await updateProfile(userId, { subscription_status: 'active' });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handler error for', event.type, ':', err);
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };