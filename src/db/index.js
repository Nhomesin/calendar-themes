const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { mergeWithDefaults } = require('../services/themeDefaults');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Kept as a no-op so callers that still `await initDb()` don't break.
// The Supabase client is ready to use as soon as this module loads.
async function initDb() {
  // Touch the client to surface config errors early rather than on first request.
  const { error } = await supabase.from('locations').select('location_id').limit(1);
  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows (empty table is fine). Anything else is a real error.
    throw new Error(`Supabase connection check failed: ${error.message}`);
  }
}

function throwIfError(error, context) {
  if (error) throw new Error(`[db:${context}] ${error.message}`);
}

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

// ── Locations ─────────────────────────────────────────────────────────────

const locationQueries = {
  async get(locationId) {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('location_id', locationId)
      .eq('active', 1)
      .maybeSingle();
    throwIfError(error, 'locations.get');
    return data || null;
  },

  async upsert(row) {
    const payload = {
      location_id: row.location_id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      token_expires_at: row.token_expires_at,
      company_id: row.company_id || null,
      location_name: row.location_name || null,
      active: 1,
    };
    // Only include plan_tier on explicit set so upserts don't clobber a
    // row whose tier was promoted by billing.
    if (row.plan_tier) payload.plan_tier = row.plan_tier;
    const { error } = await supabase
      .from('locations')
      .upsert(payload, { onConflict: 'location_id' });
    throwIfError(error, 'locations.upsert');
  },

  async listByCompany(companyId) {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('company_id', companyId)
      .eq('active', 1);
    throwIfError(error, 'locations.listByCompany');
    return data || [];
  },

  async updateTokens(row) {
    const { error } = await supabase
      .from('locations')
      .update({
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        token_expires_at: row.token_expires_at,
      })
      .eq('location_id', row.location_id);
    throwIfError(error, 'locations.updateTokens');
  },

  async deactivate(locationId) {
    const { error } = await supabase
      .from('locations')
      .update({ active: 0 })
      .eq('location_id', locationId);
    throwIfError(error, 'locations.deactivate');
  },
};

// ── Companies (agency-level installs) ─────────────────────────────────────

const companyQueries = {
  async get(companyId) {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('company_id', companyId)
      .eq('active', 1)
      .maybeSingle();
    throwIfError(error, 'companies.get');
    return data || null;
  },

  async upsert(row) {
    const payload = {
      company_id: row.company_id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      token_expires_at: row.token_expires_at,
      company_name: row.company_name || null,
      install_to_future: !!row.install_to_future,
      active: 1,
    };
    if (row.plan_tier) payload.plan_tier = row.plan_tier;
    const { error } = await supabase
      .from('companies')
      .upsert(payload, { onConflict: 'company_id' });
    throwIfError(error, 'companies.upsert');
  },

  async updateTokens(row) {
    const { error } = await supabase
      .from('companies')
      .update({
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        token_expires_at: row.token_expires_at,
      })
      .eq('company_id', row.company_id);
    throwIfError(error, 'companies.updateTokens');
  },

  async deactivate(companyId) {
    const { error } = await supabase
      .from('companies')
      .update({ active: 0 })
      .eq('company_id', companyId);
    throwIfError(error, 'companies.deactivate');
  },
};

// ── Themes (v2) ───────────────────────────────────────────────────────────

const themeQueries = {
  async list(locationId) {
    const { data, error } = await supabase
      .from('themes_v2')
      .select('*')
      .eq('location_id', locationId)
      .order('created_at', { ascending: true });
    throwIfError(error, 'themes.list');
    return data || [];
  },

  async get(themeId) {
    const { data, error } = await supabase
      .from('themes_v2')
      .select('*')
      .eq('id', themeId)
      .maybeSingle();
    throwIfError(error, 'themes.get');
    return data || null;
  },

  async getByCalendar(calendarId) {
    const { data, error } = await supabase
      .from('theme_assignments')
      .select('themes_v2(*)')
      .eq('calendar_id', calendarId)
      .maybeSingle();
    throwIfError(error, 'themes.getByCalendar');
    return data?.themes_v2 || null;
  },

  async create(locationId, name, config) {
    const id = crypto.randomUUID();
    const merged = mergeWithDefaults(config);
    const ts = nowEpoch();
    const { data, error } = await supabase
      .from('themes_v2')
      .insert({
        id,
        location_id: locationId,
        name: name || 'Untitled Theme',
        config: merged,
        created_at: ts,
        updated_at: ts,
      })
      .select('*')
      .single();
    throwIfError(error, 'themes.create');
    return data;
  },

  async update(themeId, name, config) {
    const existing = await this.get(themeId);
    if (!existing) return null;
    const merged = mergeWithDefaults(config);
    const { data, error } = await supabase
      .from('themes_v2')
      .update({
        name: name || existing.name,
        config: merged,
        updated_at: nowEpoch(),
      })
      .eq('id', themeId)
      .select('*')
      .single();
    throwIfError(error, 'themes.update');
    return data;
  },

  async delete(themeId) {
    const { error } = await supabase
      .from('themes_v2')
      .delete()
      .eq('id', themeId);
    throwIfError(error, 'themes.delete');
  },

  async duplicate(themeId, newName) {
    const original = await this.get(themeId);
    if (!original) return null;
    return this.create(
      original.location_id,
      newName || `${original.name} (copy)`,
      original.config,
    );
  },
};

// ── Assignments ───────────────────────────────────────────────────────────

const assignmentQueries = {
  async list(locationId) {
    const { data, error } = await supabase
      .from('theme_assignments')
      .select('*')
      .eq('location_id', locationId)
      .order('created_at', { ascending: true });
    throwIfError(error, 'assignments.list');
    return data || [];
  },

  async getByCalendar(calendarId) {
    const { data, error } = await supabase
      .from('theme_assignments')
      .select('*')
      .eq('calendar_id', calendarId)
      .maybeSingle();
    throwIfError(error, 'assignments.getByCalendar');
    return data || null;
  },

  async getByCalendarIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const { data, error } = await supabase
      .from('theme_assignments')
      .select('calendar_id, location_id, themes_v2(config)')
      .in('calendar_id', ids);
    throwIfError(error, 'assignments.getByCalendarIds');
    return (data || []).map((r) => ({
      calendar_id: r.calendar_id,
      location_id: r.location_id,
      primary_color: r.themes_v2?.config?.colors?.primary || '#6C63FF',
    }));
  },

  async listByTheme(themeId) {
    const { data, error } = await supabase
      .from('theme_assignments')
      .select('*')
      .eq('theme_id', themeId);
    throwIfError(error, 'assignments.listByTheme');
    return data || [];
  },

  async assign(locationId, themeId, calendarId, calendarName) {
    const id = crypto.randomUUID();
    const { error } = await supabase
      .from('theme_assignments')
      .upsert(
        {
          id,
          location_id: locationId,
          theme_id: themeId,
          calendar_id: calendarId,
          calendar_name: calendarName || null,
          created_at: nowEpoch(),
        },
        { onConflict: 'calendar_id' },
      );
    throwIfError(error, 'assignments.assign');
    return this.getByCalendar(calendarId);
  },

  async unassign(assignmentId) {
    const { error } = await supabase
      .from('theme_assignments')
      .delete()
      .eq('id', assignmentId);
    throwIfError(error, 'assignments.unassign');
  },
};

module.exports = {
  initDb,
  companyQueries,
  locationQueries,
  themeQueries,
  assignmentQueries,
  supabase,
};
