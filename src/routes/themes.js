const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { themeQueries } = require('../db');
const { compileTheme } = require('../services/cssCompiler');
const { getCalendars, pushCssToCalendar } = require('../services/ghl');

// GET /api/themes/:locationId — fetch current theme config
router.get('/:locationId', requireLocation, (req, res) => {
  const theme = themeQueries.get(req.params.locationId);
  if (!theme) {
    return res.json({
      location_id:   req.params.locationId,
      primary_color: '#6C63FF',
      bg_color:      '#FFFFFF',
      text_color:    '#1A1A1A',
      button_color:  '#6C63FF',
      button_text:   '#FFFFFF',
      font_family:   "'DM Sans', sans-serif",
      border_radius: 8,
      custom_css:    '',
    });
  }
  res.json(theme);
});

// POST /api/themes/:locationId — save theme + push CSS to GHL calendars
router.post('/:locationId', requireLocation, async (req, res) => {
  const locationId = req.params.locationId;
  const {
    primary_color, bg_color, text_color,
    button_color, button_text, font_family,
    border_radius, custom_css,
    // Optional: push to specific calendar IDs only
    calendar_ids,
  } = req.body;

  // 1. Save theme config to DB
  themeQueries.upsert({
    location_id: locationId,
    primary_color, bg_color, text_color,
    button_color, button_text, font_family,
    border_radius, custom_css,
  });

  // 2. Compile the CSS
  const savedTheme = themeQueries.get(locationId);
  const css = compileTheme(savedTheme);

  // 3. Push CSS to GHL calendars
  const pushResults = [];

  try {
    // If specific calendar IDs were passed, use those — otherwise push to all
    let targets = [];

    if (calendar_ids && calendar_ids.length > 0) {
      targets = calendar_ids.map(id => ({ id }));
    } else {
      targets = await getCalendars(req.accessToken, locationId);
    }

    for (const cal of targets) {
      const result = await pushCssToCalendar(req.accessToken, cal.id, css);
      pushResults.push({ calendarId: cal.id, ...result });
    }

    const allOk = pushResults.every(r => r.ok);

    res.json({
      ok: true,
      message: 'Theme saved.',
      css_pushed: pushResults.length,
      push_results: pushResults,
      ...(allOk ? {} : { warning: 'Some calendars could not be updated — check push_results.' }),
    });
  } catch (err) {
    console.error('[Themes] Push error:', err.message);
    // Theme is saved in DB even if push fails — not a fatal error
    res.json({
      ok: true,
      message: 'Theme saved to DB.',
      warning: 'Could not push CSS to calendars: ' + err.message,
      push_results: pushResults,
    });
  }
});

// GET /theme.css?locationId=xxx — serve compiled CSS
router.get('/css', (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).send('/* missing locationId */');
  const theme = themeQueries.get(locationId);
  const css = compileTheme(theme);
  res.setHeader('Content-Type', 'text/css');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(css);
});

module.exports = router;