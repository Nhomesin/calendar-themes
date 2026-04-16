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

// ── Embed page — themed calendar booking ─────────────────────────────────────
// GET /embed/:locationId/:calendarId
app.get('/embed/:locationId/:calendarId', (req, res) => {
  const { locationId, calendarId } = req.params;
  const name = req.query.name || 'Book an appointment';

  const theme = themeQueries.get(locationId);
  const css   = compileTheme(theme);

  // Extract just the :root block to inject
  const rootMatch = css.match(/:root[\s\S]*?\{[\s\S]*?\}/);
  const rootCss   = rootMatch ? rootMatch[0] : '';

  const fs       = require('fs');
  const tmplPath = require('path').join(__dirname, '../public/embed.html');
  let html = fs.readFileSync(tmplPath, 'utf8');

  // Inject theme CSS
  html = html.replace('/* THEME_PLACEHOLDER */', rootCss);

  // Inject calendarId, locationId, name directly as JS variables
  // so the client never needs to parse params — values come from the server
  html = html.replace(
    '/* SERVER_VARS_PLACEHOLDER */',
    `var SERVER_CALENDAR_ID = ${JSON.stringify(calendarId)};
     var SERVER_LOCATION_ID = ${JSON.stringify(locationId)};
     var SERVER_NAME        = ${JSON.stringify(name)};`
  );

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'CalTheme', ts: new Date().toISOString() });
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/installed', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/installed.html'));
});

// Theme builder UI
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/app.html'));
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