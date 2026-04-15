const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/caltheme.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    location_id     TEXT PRIMARY KEY,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    company_id      TEXT,
    location_name   TEXT,
    installed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    active          INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS themes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id     TEXT NOT NULL UNIQUE,
    primary_color   TEXT NOT NULL DEFAULT '#6C63FF',
    bg_color        TEXT NOT NULL DEFAULT '#FFFFFF',
    text_color      TEXT NOT NULL DEFAULT '#1A1A1A',
    button_color    TEXT NOT NULL DEFAULT '#6C63FF',
    button_text     TEXT NOT NULL DEFAULT '#FFFFFF',
    font_family     TEXT NOT NULL DEFAULT 'Inter, sans-serif',
    border_radius   INTEGER NOT NULL DEFAULT 8,
    custom_css      TEXT NOT NULL DEFAULT '',
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE
  );
`);

// ── Helpers ─────────────────────────────────────────────────────────────────

const locationQueries = {
  upsert: db.prepare(`
    INSERT INTO locations (location_id, access_token, refresh_token, token_expires_at, company_id, location_name)
    VALUES (@location_id, @access_token, @refresh_token, @token_expires_at, @company_id, @location_name)
    ON CONFLICT(location_id) DO UPDATE SET
      access_token    = excluded.access_token,
      refresh_token   = excluded.refresh_token,
      token_expires_at = excluded.token_expires_at,
      company_id      = excluded.company_id,
      location_name   = excluded.location_name,
      active          = 1
  `),

  get: db.prepare(`SELECT * FROM locations WHERE location_id = ? AND active = 1`),

  updateTokens: db.prepare(`
    UPDATE locations
    SET access_token = @access_token,
        refresh_token = @refresh_token,
        token_expires_at = @token_expires_at
    WHERE location_id = @location_id
  `),

  deactivate: db.prepare(`UPDATE locations SET active = 0 WHERE location_id = ?`),
};

const themeQueries = {
  get: db.prepare(`SELECT * FROM themes WHERE location_id = ?`),

  upsert: db.prepare(`
    INSERT INTO themes (location_id, primary_color, bg_color, text_color, button_color, button_text, font_family, border_radius, custom_css, updated_at)
    VALUES (@location_id, @primary_color, @bg_color, @text_color, @button_color, @button_text, @font_family, @border_radius, @custom_css, unixepoch())
    ON CONFLICT(location_id) DO UPDATE SET
      primary_color = excluded.primary_color,
      bg_color      = excluded.bg_color,
      text_color    = excluded.text_color,
      button_color  = excluded.button_color,
      button_text   = excluded.button_text,
      font_family   = excluded.font_family,
      border_radius = excluded.border_radius,
      custom_css    = excluded.custom_css,
      updated_at    = unixepoch()
  `),
};

module.exports = { db, locationQueries, themeQueries };
