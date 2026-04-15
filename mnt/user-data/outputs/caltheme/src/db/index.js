require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initDb } = require('./db');
const oauthRoutes = require('./routes/oauth');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.APP_BASE_URL }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/oauth', oauthRoutes);
app.use('/webhooks', webhookRoutes);

// Health check — Railway uses this to confirm the app is up
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'CalTheme', ts: new Date().toISOString() });
});

// Post-install page
app.get('/installed', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/installed.html'));
});

// Theme builder UI placeholder (Step 4 will fill this in)
app.get('/app', (req, res) => {
  res.send(`
    <html><body style="font-family:sans-serif;padding:2rem">
      <h2>CalTheme Builder</h2>
      <p>Location ID: <strong>${req.query.locationId || 'not provided'}</strong></p>
      <p style="color:#888">Theme builder UI coming in Step 4.</p>
    </body></html>
  `);
});

// ── Start — init DB first, then open for traffic ───────────────────────
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`CalTheme running on port ${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
