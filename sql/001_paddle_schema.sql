-- ─────────────────────────────────────────────────────────────────────────────
-- Paddle billing schema — migration 001
--
-- Run once in the Supabase SQL Editor. Confirm both `subscriptions` and
-- `webhook_events` exist and have RLS enabled after applying:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename in ('subscriptions','webhook_events');
--
-- Scope: this migration does NOT create an `accounts` table. GHL install
-- identity already lives in `public.locations` and `public.companies`
-- (see supabase/schema.sql). A subscription row is owned by exactly one
-- of those two scopes, enforced by a CHECK constraint.
-- ─────────────────────────────────────────────────────────────────────────────

-- One subscription per install scope (location OR company).
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id             TEXT REFERENCES public.locations(location_id) ON DELETE CASCADE,
  company_id              TEXT REFERENCES public.companies(company_id)  ON DELETE CASCADE,
  paddle_customer_id      TEXT,
  paddle_subscription_id  TEXT UNIQUE,
  paddle_price_id         TEXT,
  status                  TEXT NOT NULL,              -- trialing | active | past_due | canceled | paused
  plan_tier               TEXT,                       -- subaccount | agency
  billing_cycle           TEXT,                       -- monthly | yearly
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  trial_ends_at           TIMESTAMPTZ,
  canceled_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_scope_chk CHECK (
    (location_id IS NOT NULL) <> (company_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS subscriptions_location_idx    ON public.subscriptions(location_id);
CREATE INDEX IF NOT EXISTS subscriptions_company_idx     ON public.subscriptions(company_id);
CREATE INDEX IF NOT EXISTS subscriptions_paddle_sub_idx  ON public.subscriptions(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx      ON public.subscriptions(status);

-- Webhook idempotency log. Every Paddle delivery — successful, duplicated,
-- or failed downstream — gets exactly one row keyed on paddle_event_id.
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paddle_event_id    TEXT UNIQUE NOT NULL,
  event_type         TEXT NOT NULL,
  payload            JSONB NOT NULL,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_error   TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_type_idx ON public.webhook_events(event_type);

-- ── Row Level Security — deny-all-public, match existing schema posture ──────
ALTER TABLE public.subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny public access" ON public.subscriptions;
CREATE POLICY "deny public access" ON public.subscriptions
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny public access" ON public.webhook_events;
CREATE POLICY "deny public access" ON public.webhook_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
