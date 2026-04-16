const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { themeQueries } = require('../db');
const { compileTheme } = require('../services/cssCompiler');

// GET /api/themes/:locationId — fetch current theme config
router.get('/:locationId', requireLocation, (req, res) => {
  const theme = themeQueries.get(req.params.locationId);

  if (!theme) {
    // Return defaults if no theme saved yet
    return res.json({
      location_id:   req.params.locationId,
      primary_color: '#6C63FF',
      bg_color:      '#FFFFFF',
      text_color:    '#1A1A1A',
      button_color:  '#6C63FF',
      button_text:   '#FFFFFF',
      font_family:   'Inter, sans-serif',
      border_radius: 8,
      custom_css:    '',
    });
  }

  res.json(theme);
});

// POST /api/themes/:locationId — save theme config
router.post('/:locationId', requireLocation, (req, res) => {
  const {
    primary_color,
    bg_color,
    text_color,
    button_color,
    button_text,
    font_family,
    border_radius,
    custom_css,
  } = req.body;

  themeQueries.upsert({
    location_id: req.params.locationId,
    primary_color,
    bg_color,
    text_color,
    button_color,
    button_text,
    font_family,
    border_radius,
    custom_css,
  });

  res.json({ ok: true, message: 'Theme saved.' });
});

// GET /theme.css?locationId=xxx — serve compiled CSS for a location
router.get('/css', (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).send('/* missing locationId */');

  const theme = themeQueries.get(locationId);
  const css = compileTheme(theme);

  res.setHeader('Content-Type', 'text/css');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
  res.send(css);
});

module.exports = router;