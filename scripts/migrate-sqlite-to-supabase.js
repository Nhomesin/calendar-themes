/**
 * One-shot migration from the legacy sql.js / caltheme.db file → Supabase.
 *
 * Usage (run from the repo root, once, locally):
 *
 *   DB_PATH=./caltheme.db \
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   node scripts/migrate-sqlite-to-supabase.js
 *
 * Pull caltheme.db off the Railway volume first (Railway CLI or volume browser).
 * The schema must already exist in Supabase — run supabase/schema.sql there first.
 *
 * Idempotent: upserts by primary key. Safe to re-run.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { createClient } = require('@supabase/supabase-js');
const { getDefaultConfig, mergeWithDefaults } = require('../src/services/themeDefaults');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'caltheme.db');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`SQLite database not found at ${DB_PATH}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function rowsFromStatement(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

async function main() {
  console.log(`[migrate] Loading ${DB_PATH}`);
  const wasmPath = path.join(require.resolve('sql.js'), '../../dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  // ── 1. locations ────────────────────────────────────────────────────────
  const locations = rowsFromStatement(db, 'SELECT * FROM locations');
  console.log(`[migrate] locations: ${locations.length} rows`);
  if (locations.length) {
    const payload = locations.map(row => ({
      location_id: row.location_id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      token_expires_at: Number(row.token_expires_at),
      company_id: row.company_id || null,
      location_name: row.location_name || null,
      installed_at: Number(row.installed_at),
      active: Number(row.active ?? 1),
    }));
    const { error } = await supabase.from('locations').upsert(payload, { onConflict: 'location_id' });
    if (error) throw new Error(`locations upsert failed: ${error.message}`);
  }

  // ── 2. themes_v2 ────────────────────────────────────────────────────────
  const themesV2 = rowsFromStatement(db, 'SELECT * FROM themes_v2');
  console.log(`[migrate] themes_v2: ${themesV2.length} rows`);
  if (themesV2.length) {
    const payload = themesV2.map(row => ({
      id: row.id,
      location_id: row.location_id,
      name: row.name,
      // The source column is TEXT; Postgres column is JSONB — parse before insert.
      config: safeJson(row.config),
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
    }));
    const { error } = await supabase.from('themes_v2').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(`themes_v2 upsert failed: ${error.message}`);
  }

  // ── 3. theme_assignments ────────────────────────────────────────────────
  const assignments = rowsFromStatement(db, 'SELECT * FROM theme_assignments');
  console.log(`[migrate] theme_assignments: ${assignments.length} rows`);
  if (assignments.length) {
    const payload = assignments.map(row => ({
      id: row.id,
      location_id: row.location_id,
      theme_id: row.theme_id,
      calendar_id: row.calendar_id,
      calendar_name: row.calendar_name || null,
      created_at: Number(row.created_at),
    }));
    const { error } = await supabase.from('theme_assignments').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(`theme_assignments upsert failed: ${error.message}`);
  }

  // ── 4. v1 themes → themes_v2 (promote any that haven't been) ────────────
  let v1Rows = [];
  try {
    v1Rows = rowsFromStatement(db, 'SELECT * FROM themes');
  } catch (_) {
    // v1 table may not exist in newer dumps — that's fine.
  }
  console.log(`[migrate] v1 themes: ${v1Rows.length} rows`);
  let v1Promoted = 0;
  for (const row of v1Rows) {
    // Skip if this location already has a v2 theme in Supabase.
    const { data: existing, error: checkErr } = await supabase
      .from('themes_v2')
      .select('id')
      .eq('location_id', row.location_id)
      .limit(1)
      .maybeSingle();
    if (checkErr) throw new Error(`v1 check failed: ${checkErr.message}`);
    if (existing) continue;

    const defaults = getDefaultConfig();
    const config = mergeWithDefaults({
      ...defaults,
      colors: {
        ...defaults.colors,
        primary: row.primary_color || defaults.colors.primary,
        background: row.bg_color || defaults.colors.background,
        text: row.text_color || defaults.colors.text,
        buttonBg: row.button_color || defaults.colors.buttonBg,
        buttonText: row.button_text || defaults.colors.buttonText,
      },
      typography: {
        ...defaults.typography,
        fontFamily: row.font_family || defaults.typography.fontFamily,
      },
      spacing: {
        ...defaults.spacing,
        borderRadius: row.border_radius ?? defaults.spacing.borderRadius,
      },
      customCss: row.custom_css || '',
    });

    const ts = Math.floor(Date.now() / 1000);
    const { error: insErr } = await supabase.from('themes_v2').insert({
      id: crypto.randomUUID(),
      location_id: row.location_id,
      name: 'Migrated Theme',
      config,
      created_at: ts,
      updated_at: ts,
    });
    if (insErr) throw new Error(`v1 promotion failed: ${insErr.message}`);
    v1Promoted++;
  }
  if (v1Promoted) console.log(`[migrate] Promoted ${v1Promoted} v1 themes to themes_v2`);

  console.log('[migrate] Done.');
}

function safeJson(val) {
  if (val == null) return {};
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}

main().catch(err => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
