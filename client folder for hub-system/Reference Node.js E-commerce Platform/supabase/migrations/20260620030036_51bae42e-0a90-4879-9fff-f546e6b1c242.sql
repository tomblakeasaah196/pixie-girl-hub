
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_order_updates boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_concierge boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_marketing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_loyalty boolean NOT NULL DEFAULT true;
