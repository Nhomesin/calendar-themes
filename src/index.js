require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initDb } = require('./db');
const oauthRoutes    = require('./routes/oauth');
const webhookRoutes  = require('./routes/webhooks');
const themeRoutes    = require('./routes/themes');
const calendarRoutes = require('./routes/calendars');
const { themeQueries } = require('./db');
const { compileTheme }  = require('./services/cssCompiler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [process.env.APP_BASE_URL, /\.railway\.app$/].filter(Boolean),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── OAuth + Webhooks ──────────────────────────────────────────────────────────
app.use('/oauth',    oauthRoutes);
app.use('/webhooks', webhookRoutes);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/themes',    themeRoutes);
app.use('/api/calendars', calendarRoutes);

// ── /theme.css — top-level endpoint used by embed pages ──────────────────────
// GET /theme.css?locationId=xxx
app.get('/theme.css', (req, res) => {
  const { locationId } = req.query;

  if (!locationId) {
    res.setHeader('Content-Type', 'text/css');
    return res.send('/* missing locationId */');
  }

  const theme = themeQueries.get(locationId);
  const css   = compileTheme(theme); // falls back to defaults if no theme saved yet

  res.setHeader('Content-Type', 'text/css');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(css);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'CalTheme', ts: new Date().toISOString() });
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/installed', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/installed.html'));
});

// Theme builder UI — Step 4 will replace this placeholder
app.get('/app', (req, res) => {
  const locationId = req.query.locationId || '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CalTheme Builder</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 2rem; background: #f5f5f5; }
    .card { background: #fff; border-radius: 12px; padding: 2rem; max-width: 480px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    h2 { margin: 0 0 1rem; font-size: 1.2rem; }
    .badge { display: inline-block; background: #EAF3DE; color: #27500A; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; margin-bottom: 1rem; }
    p { color: #666; font-size: 14px; line-height: 1.6; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>CalTheme Builder</h2>
    <div class="badge">Step 3 complete — API ready</div>
    <p>Location ID: <code>${locationId || 'not provided'}</code></p>
    <p>The following API endpoints are now live:</p>
    <p>
      <code>GET /api/themes/${locationId || ':locationId'}</code><br><br>
      <code>POST /api/themes/${locationId || ':locationId'}</code><br><br>
      <code>GET /api/calendars/${locationId || ':locationId'}</code><br><br>
      <code>GET /theme.css?locationId=${locationId || '...'}</code>
    </p>
    <p style="color:#999;margin-top:1.5rem">Theme builder UI coming in Step 4.</p>
  </div>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`CalTheme running on port ${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });