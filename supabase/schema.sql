-- ─────────────────────────────────────────────────────────────────────────────
-- CalTheme — Supabase / Postgres schema
--
-- Run once in the Supabase SQL editor (or via `supabase db execute`).
--
-- Security posture:
--   - The app is 100% server-side. Only the Node process (using the
--     service-role key) ever touches these tables.
--   - RLS is ENABLED on every table with ZERO public policies, which means:
--       • service_role  → bypasses RLS by definition → full access
--       • anon          → denied (no policy grants access)
--       • authenticated → denied (no policy grants access)
--   - If you ever expose these tables to the browser/anon key, add policies
--     here first — never disable RLS as a shortcut.
-- ─────────────────────────────────────────────────────────────────────────────

-- GHL agency (company-level) OAuth credentials. Populated only when the
-- agency admin does a bulk install across their sub-accounts. Individual
-- sub-account installs skip this table entirely.
CREATE TABLE IF NOT EXISTS public.companies (
  company_id          TEXT PRIMARY KEY,
  access_token        TEXT     NOT NULL,
  refresh_token       TEXT     NOT NULL,
  token_expires_at    BIGINT   NOT NULL,                              -- epoch seconds
  company_name        TEXT,
  install_to_future   BOOLEAN  NOT NULL DEFAULT FALSE,                -- auto-provision new sub-accounts
  plan_tier           TEXT     NOT NULL DEFAULT 'free',               -- free | agency (set by billing later)
  installed_at        BIGINT   NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  active              SMALLINT NOT NULL DEFAULT 1
);

-- GHL sub-account OAuth credentials.
-- `company_id` is set when the row was provisioned via an agency bulk install;
-- null when a sub-account admin installed the app directly.
CREATE TABLE IF NOT EXISTS public.locations (
  location_id       TEXT PRIMARY KEY,
  access_token      TEXT      NOT NULL,
  refresh_token     TEXT      NOT NULL,
  token_expires_at  BIGINT    NOT NULL,                               -- epoch seconds
  company_id        TEXT      REFERENCES public.companies(company_id) ON DELETE SET NULL,
  location_name     TEXT,
  plan_tier         TEXT      NOT NULL DEFAULT 'free',                -- free | subaccount (set by billing later)
  installed_at      BIGINT    NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  active            SMALLINT  NOT NULL DEFAULT 1                      -- 1 = installed, 0 = uninstalled
);

-- Backfill columns for deployments migrated before this change.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free';

-- v2 themes: many per location, full JSON config.
--
-- `is_public` flips the theme into the community gallery / marketing-site
-- surface (unauthenticated SELECT allowed by RLS below). Writes are always
-- server-only regardless of visibility.
CREATE TABLE IF NOT EXISTS public.themes_v2 (
  id           TEXT    PRIMARY KEY,                                   -- UUID from crypto.randomUUID()
  location_id  TEXT    NOT NULL REFERENCES public.locations(location_id) ON DELETE CASCADE,
  name         TEXT    NOT NULL DEFAULT 'Untitled Theme',
  config       JSONB   NOT NULL DEFAULT '{}'::jsonb,
  is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at   BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- For existing deployments migrated before this column existed.
ALTER TABLE public.themes_v2
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_themes_v2_location ON public.themes_v2(location_id);

-- Partial index for gallery queries (`WHERE is_public = true ORDER BY updated_at`).
CREATE INDEX IF NOT EXISTS idx_themes_v2_public_updated
  ON public.themes_v2(updated_at DESC)
  WHERE is_public = TRUE;

-- Calendar → theme binding. One theme per calendar (calendar_id is unique).
CREATE TABLE IF NOT EXISTS public.theme_assignments (
  id             TEXT   PRIMARY KEY,                                  -- UUID from crypto.randomUUID()
  location_id    TEXT   NOT NULL REFERENCES public.locations(location_id) ON DELETE CASCADE,
  theme_id       TEXT   NOT NULL REFERENCES public.themes_v2(id)     ON DELETE CASCADE,
  calendar_id    TEXT   NOT NULL UNIQUE,
  calendar_name  TEXT,
  created_at     BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_assignments_location ON public.theme_assignments(location_id);
CREATE INDEX IF NOT EXISTS idx_assignments_theme    ON public.theme_assignments(theme_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS everywhere. service_role bypasses RLS by definition, so the app
-- keeps full access. anon/authenticated are then deny-by-default unless a
-- policy below explicitly grants something.

ALTER TABLE public.companies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.themes_v2         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_assignments ENABLE ROW LEVEL SECURITY;

-- companies, locations, theme_assignments: server-only. Explicit deny for
-- clarity in the dashboard. (Equivalent to "no policy" but self-documenting.)

DROP POLICY IF EXISTS "deny public access" ON public.companies;
CREATE POLICY "deny public access" ON public.companies
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny public access" ON public.locations;
CREATE POLICY "deny public access" ON public.locations
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny public access" ON public.theme_assignments;
CREATE POLICY "deny public access" ON public.theme_assignments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- themes_v2: public rows are readable without auth (community gallery +
-- marketing site). Writes stay server-only (no INSERT/UPDATE/DELETE policy
-- granted to anon/authenticated, so RLS denies them).
--
-- Ordering note: do NOT add a `FOR ALL USING(false)` deny policy on this
-- table — Postgres OR-combines permissive policies for SELECT, so the deny
-- wouldn't override the public-read grant anyway, but having both is
-- confusing. Rely on "no grant = denied" for writes.

DROP POLICY IF EXISTS "deny public access"    ON public.themes_v2;
DROP POLICY IF EXISTS "public themes readable" ON public.themes_v2;

CREATE POLICY "public themes readable" ON public.themes_v2
  FOR SELECT TO anon, authenticated
  USING (is_public = TRUE);
