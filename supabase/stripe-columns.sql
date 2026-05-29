-- Run this SQL in your Supabase dashboard → SQL Editor
-- Adds Stripe billing columns to the profiles table

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT DEFAULT 'inactive';

-- Optional: index for fast webhook lookups by customer
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
  ON profiles (stripe_customer_id);
