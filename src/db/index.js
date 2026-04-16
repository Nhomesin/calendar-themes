const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDefaultConfig, mergeWithDefaults } = require('../services/themeDefaults');

// On Railway, use the persistent volume mount at /app/data
// Locally, fall back to the project's data/ directory
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'caltheme.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// sql.js is pure WebAssembly — no Python, no node-gyp, works everywhere
const initSqlJs = require('sql.js');

let dbSync = null;

async function initDb() {
  // locateFile tells sql.js exactly where the .wasm binary lives,
  // regardless of what the working directory is at runtime (critical on Railway)
  const wasmPath = path.join(require.resolve('sql.js'), '../../dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    dbSync = new SQL.Database(fileBuffer);
  } else {
    dbSync = new SQL.Database();
  }

  // ── Existing tables (kept for migration) ─────────────────────────────────
  dbSync.run(`
    CREATE TABLE IF NOT EXISTS locations (
      location_id      TEXT PRIMARY KEY,
      access_token     TEXT NOT NULL,
      refresh_token    TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL,
      company_id       TEXT,
      location_name    TEXT,
      installed_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      active           INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS themes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id   TEXT NOT NULL UNIQUE,
      primary_color TEXT NOT NULL DEFAULT '#6C63FF',
      bg_color      TEXT NOT NULL DEFAULT '#FFFFFF',
      text_color    TEXT NOT NULL DEFAULT '#1A1A1A',
      button_color  TEXT NOT NULL DEFAULT '#6C63FF',
      button_text   TEXT NOT NULL DEFAULT '#FFFFFF',
      font_family   TEXT NOT NULL DEFAULT 'Inter, sans-serif',
      border_radius INTEGER NOT NULL DEFAULT 8,
      custom_css    TEXT NOT NULL DEFAULT '',
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE
    );
  `);

  // ── New v2 tables ────────────────────────────────────────────────────────
  dbSync.run(`
    CREATE TABLE IF NOT EXISTS themes_v2 (
      id            TEXT PRIMARY KEY,
      location_id   TEXT NOT NULL,
      name          TEXT NOT NULL DEFAULT 'Untitled Theme',
      config        TEXT NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_themes_v2_location ON themes_v2(location_id);

    CREATE TABLE IF NOT EXISTS theme_assignments (
      id            TEXT PRIMARY KEY,
      location_id   TEXT NOT NULL,
      theme_id      TEXT NOT NULL,
      calendar_id   TEXT NOT NULL UNIQUE,
      calendar_name TEXT,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE,
      FOREIGN KEY (theme_id) REFERENCES themes_v2(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_location ON theme_assignments(location_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_theme ON theme_assignments(theme_id);
  `);

  // ── Migrate old themes → themes_v2 ──────────────────────────────────────
  migrateOldThemes();

  persist();
  return dbSync;
}

function migrateOldThemes() {
  const oldRows = getRows('SELECT * FROM themes', []);
  for (const row of oldRows) {
    // Skip if this location already has a v2 theme
    const existing = getRow(
      'SELECT id FROM themes_v2 WHERE location_id = ? LIMIT 1',
      [row.location_id]
    );
    if (existing) continue;

    const defaults = getDefaultConfig();
    const config = {
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
    };

    const id = crypto.randomUUID();
    runQuery(`
      INSERT INTO themes_v2 (id, location_id, name, config, created_at, updated_at)
      VALUES (?, ?, 'Migrated Theme', ?, strftime('%s','now'), strftime('%s','now'))
    `, [id, row.location_id, JSON.stringify(config)]);
  }
}

function persist() {
  if (!dbSync) return;
  const data = dbSync.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function getDbSync() {
  if (!dbSync) throw new Error('DB not initialised. Call initDb() at startup.');
  return dbSync;
}

function runQuery(sql, params = []) {
  getDbSync().run(sql, params);
  persist();
}

function getRow(sql, params = []) {
  const stmt = getDbSync().prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function getRows(sql, params = []) {
  const stmt = getDbSync().prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ── Location queries ───────────────────────────────────────────────────────

const locationQueries = {
  upsert(row) {
    runQuery(`
      INSERT INTO locations (location_id, access_token, refresh_token, token_expires_at, company_id, location_name)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id) DO UPDATE SET
        access_token     = excluded.access_token,
        refresh_token    = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        company_id       = excluded.company_id,
        location_name    = excluded.location_name,
        active           = 1
    `, [
      row.location_id,
      row.access_token,
      row.refresh_token,
      row.token_expires_at,
      row.company_id || null,
      row.location_name || null,
    ]);
  },

  get(locationId) {
    return getRow('SELECT * FROM locations WHERE location_id = ? AND active = 1', [locationId]);
  },

  updateTokens(row) {
    runQuery(`
      UPDATE locations SET
        access_token     = ?,
        refresh_token    = ?,
        token_expires_at = ?
      WHERE location_id  = ?
    `, [row.access_token, row.refresh_token, row.token_expires_at, row.location_id]);
  },

  deactivate(locationId) {
    runQuery('UPDATE locations SET active = 0 WHERE location_id = ?', [locationId]);
  },
};

// ── Theme queries (v2 — multiple themes per location, JSON config) ────────

const themeQueries = {
  list(locationId) {
    return getRows('SELECT * FROM themes_v2 WHERE location_id = ? ORDER BY created_at ASC', [locationId]);
  },

  get(themeId) {
    const row = getRow('SELECT * FROM themes_v2 WHERE id = ?', [themeId]);
    if (row) row.config = JSON.parse(row.config || '{}');
    return row;
  },

  getByCalendar(calendarId) {
    const row = getRow(`
      SELECT t.* FROM themes_v2 t
      INNER JOIN theme_assignments a ON a.theme_id = t.id
      WHERE a.calendar_id = ?
    `, [calendarId]);
    if (row) row.config = JSON.parse(row.config || '{}');
    return row;
  },

  create(locationId, name, config) {
    const id = crypto.randomUUID();
    const merged = mergeWithDefaults(config);
    runQuery(`
      INSERT INTO themes_v2 (id, location_id, name, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))
    `, [id, locationId, name || 'Untitled Theme', JSON.stringify(merged)]);
    return this.get(id);
  },

  update(themeId, name, config) {
    const existing = this.get(themeId);
    if (!existing) return null;
    const merged = mergeWithDefaults(config);
    runQuery(`
      UPDATE themes_v2 SET name = ?, config = ?, updated_at = strftime('%s','now')
      WHERE id = ?
    `, [name || existing.name, JSON.stringify(merged), themeId]);
    return this.get(themeId);
  },

  delete(themeId) {
    runQuery('DELETE FROM themes_v2 WHERE id = ?', [themeId]);
  },

  duplicate(themeId, newName) {
    const original = this.get(themeId);
    if (!original) return null;
    return this.create(original.location_id, newName || `${original.name} (copy)`, original.config);
  },
};

// ── Assignment queries ────────────────────────────────────────────────────

const assignmentQueries = {
  list(locationId) {
    return getRows('SELECT * FROM theme_assignments WHERE location_id = ? ORDER BY created_at ASC', [locationId]);
  },

  getByCalendar(calendarId) {
    return getRow('SELECT * FROM theme_assignments WHERE calendar_id = ?', [calendarId]);
  },

  listByTheme(themeId) {
    return getRows('SELECT * FROM theme_assignments WHERE theme_id = ?', [themeId]);
  },

  assign(locationId, themeId, calendarId, calendarName) {
    const id = crypto.randomUUID();
    // UNIQUE(calendar_id) — INSERT OR REPLACE swaps the old assignment
    runQuery(`
      INSERT OR REPLACE INTO theme_assignments (id, location_id, theme_id, calendar_id, calendar_name, created_at)
      VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
    `, [id, locationId, themeId, calendarId, calendarName || null]);
    return this.getByCalendar(calendarId);
  },

  unassign(assignmentId) {
    runQuery('DELETE FROM theme_assignments WHERE id = ?', [assignmentId]);
  },
};

module.exports = { initDb, locationQueries, themeQueries, assignmentQueries };
