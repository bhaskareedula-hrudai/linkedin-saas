import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured. Add it to Vercel environment variables.');
    _stripe = new Stripe(key, { apiVersion: '2025-04-30' as any });
  }
  return _stripe;
}

export const STRIPE_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER ?? '',
  professional: process.env.STRIPE_PRICE_PROFESSIONAL ?? '',
  'brand-pro': process.env.STRIPE_PRICE_BRAND_PRO ?? '',
};
