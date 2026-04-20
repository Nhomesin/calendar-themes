require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const { initDb } = require('./db');
const oauthRoutes      = require('./routes/oauth');
const webhookRoutes    = require('./routes/webhooks');
const themeRoutes      = require('./routes/themes');
const calendarRoutes   = require('./routes/calendars');
const assignmentRoutes = require('./routes/assignments');
const bookingRoutes    = require('./routes/booking');
const { themeQueries, assignmentQueries } = require('./db');
const { getDefaultConfig } = require('./services/themeDefaults');
const { presets } = require('./services/presets');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.APP_BASE_URL,
    /\.railway\.app$/,
    /\.gohighlevel\.com$/,
    /\.leadconnectorhq\.com$/,
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Allow framing on any site. GHL often uses white-labeled agency domains
// (app.myagency.com etc), so pinning to *.gohighlevel.com breaks installs.
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// ── OAuth + Webhooks ──────────────────────────────────────────────────────────
app.use('/oauth',    oauthRoutes);
app.use('/webhooks', webhookRoutes);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/themes',      themeRoutes);
app.use('/api/calendars',   calendarRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api',             bookingRoutes);

// ── Presets (no auth needed) ──────────────────────────────────────────────
app.get('/api/presets', (req, res) => {
  res.json({
    presets: presets.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      previewColors: p.previewColors,
      config: p.config,
    })),
  });
});

// ── Embed page — themed calendar booking ─────────────────────────────────────
// GET /embed/:locationId/:calendarId
app.get('/embed/:locationId/:calendarId', async (req, res, next) => {
  try {
  const { locationId, calendarId } = req.params;
  const name = req.query.name || 'Book an Appointment';

  // Look up theme assignment for this calendar
  const assignment = await assignmentQueries.getByCalendar(calendarId);

  if (assignment) {
    // Custom theme assigned — serve the custom booking UI
    const theme = await themeQueries.get(assignment.theme_id);
    const config = theme ? theme.config : getDefaultConfig();

    const tmplPath = path.join(__dirname, '../public/embed.html');
    let html = fs.readFileSync(tmplPath, 'utf8');

    html = html.replace(
      '/* SERVER_VARS_PLACEHOLDER */',
      `var SERVER_CALENDAR_ID = ${JSON.stringify(calendarId)};
       var SERVER_LOCATION_ID = ${JSON.stringify(locationId)};
       var SERVER_NAME        = ${JSON.stringify(name)};
       var SERVER_THEME_CONFIG = ${JSON.stringify(config)};`
    );

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } else {
    // No theme assigned — fall back to GHL native widget iframe
    const tmplPath = path.join(__dirname, '../public/embed-fallback.html');
    let html = fs.readFileSync(tmplPath, 'utf8');

    html = html.replace(
      '/* SERVER_VARS_PLACEHOLDER */',
      `var SERVER_CALENDAR_ID = ${JSON.stringify(calendarId)};
       var SERVER_LOCATION_ID = ${JSON.stringify(locationId)};
       var SERVER_NAME        = ${JSON.stringify(name)};`
    );

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
  } catch (err) {
    next(err);
  }
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
