const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'caltheme.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// sql.js is pure WebAssembly — no Python, no node-gyp, works everywhere
const initSqlJs = require('sql.js');

let dbSync = null;

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    dbSync = new SQL.Database(fileBuffer);
  } else {
    dbSync = new SQL.Database();
  }

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

  persist();
  return dbSync;
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

function runQuery(sql, params = {}) {
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

// ── Location queries ───────────────────────────────────────────────────────

const locationQueries = {
  upsert(row) {
    runQuery(`
      INSERT INTO locations (location_id, access_token, refresh_token, token_expires_at, company_id, location_name)
      VALUES (:location_id, :access_token, :refresh_token, :token_expires_at, :company_id, :location_name)
      ON CONFLICT(location_id) DO UPDATE SET
        access_token     = excluded.access_token,
        refresh_token    = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        company_id       = excluded.company_id,
        location_name    = excluded.location_name,
        active           = 1
    `, {
      ':location_id': row.location_id,
      ':access_token': row.access_token,
      ':refresh_token': row.refresh_token,
      ':token_expires_at': row.token_expires_at,
      ':company_id': row.company_id || null,
      ':location_name': row.location_name || null,
    });
  },

  get(locationId) {
    return getRow(`SELECT * FROM locations WHERE location_id = ? AND active = 1`, [locationId]);
  },

  updateTokens(row) {
    runQuery(`
      UPDATE locations SET
        access_token     = :access_token,
        refresh_token    = :refresh_token,
        token_expires_at = :token_expires_at
      WHERE location_id  = :location_id
    `, {
      ':access_token': row.access_token,
      ':refresh_token': row.refresh_token,
      ':token_expires_at': row.token_expires_at,
      ':location_id': row.location_id,
    });
  },

  deactivate(locationId) {
    runQuery(`UPDATE locations SET active = 0 WHERE location_id = ?`, [locationId]);
  },
};

// ── Theme queries ──────────────────────────────────────────────────────────

const themeQueries = {
  get(locationId) {
    return getRow(`SELECT * FROM themes WHERE location_id = ?`, [locationId]);
  },

  upsert(row) {
    runQuery(`
      INSERT INTO themes (location_id, primary_color, bg_color, text_color, button_color, button_text, font_family, border_radius, custom_css, updated_at)
      VALUES (:location_id, :primary_color, :bg_color, :text_color, :button_color, :button_text, :font_family, :border_radius, :custom_css, strftime('%s','now'))
      ON CONFLICT(location_id) DO UPDATE SET
        primary_color = excluded.primary_color,
        bg_color      = excluded.bg_color,
        text_color    = excluded.text_color,
        button_color  = excluded.button_color,
        button_text   = excluded.button_text,
        font_family   = excluded.font_family,
        border_radius = excluded.border_radius,
        custom_css    = excluded.custom_css,
        updated_at    = strftime('%s','now')
    `, {
      ':location_id': row.location_id,
      ':primary_color': row.primary_color || '#6C63FF',
      ':bg_color': row.bg_color || '#FFFFFF',
      ':text_color': row.text_color || '#1A1A1A',
      ':button_color': row.button_color || '#6C63FF',
      ':button_text': row.button_text || '#FFFFFF',
      ':font_family': row.font_family || 'Inter, sans-serif',
      ':border_radius': row.border_radius ?? 8,
      ':custom_css': row.custom_css || '',
    });
  },
};

module.exports = { initDb, locationQueries, themeQueries };
