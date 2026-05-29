import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe, STRIPE_PRICE_IDS } from '../../../../lib/stripe';

export const runtime = 'nodejs';

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { planId?: string; userId?: string; email?: string };
    const { planId, userId, email } = body;

    if (!planId || !userId || !email) {
      return NextResponse.json({ error: 'Missing planId, userId, or email' }, { status: 400 });
    }

    const priceId = STRIPE_PRICE_IDS[planId];
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for plan "${planId}". Set STRIPE_PRICE_${planId.toUpperCase().replace('-', '_')} in env vars.` },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const supabase = getAdminSupabase();

    // Reuse existing Stripe customer if one exists
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    let customerId: string | undefined = (profile as any)?.stripe_customer_id ?? undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;

      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (request.headers.get('origin') || 'https://linkedin-saas-three.vercel.app');

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/app/dashboard?payment=success&plan=${planId}`,
      cancel_url: `${baseUrl}/checkout/${planId}`,
      metadata: { supabase_user_id: userId, plan_id: planId },
      subscription_data: {
        metadata: { supabase_user_id: userId, plan_id: planId },
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err);
    return NextResponse.json({ error: err.message ?? 'Checkout failed' }, { status: 500 });
  }
}
