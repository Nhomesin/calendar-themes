const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { themeQueries } = require('../db');
const { compileTheme } = require('../services/cssCompiler');
const { getCalendars, pushThemeToCalendar } = require('../services/ghl');

// GET /api/themes/:locationId
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

// POST /api/themes/:locationId — save theme + push to GHL calendars
router.post('/:locationId', requireLocation, async (req, res) => {
  const locationId = req.params.locationId;
  const {
    primary_color, bg_color, text_color,
    button_color, button_text, font_family,
    border_radius, custom_css, calendar_ids,
  } = req.body;

  // 1. Save to DB
  themeQueries.upsert({
    location_id: locationId,
    primary_color, bg_color, text_color,
    button_color, button_text, font_family,
    border_radius, custom_css,
  });

  const savedTheme = themeQueries.get(locationId);
  const pushResults = [];

  // 2. Push native colors to GHL calendar widgetCustomization
  try {
    let targets = [];
    if (calendar_ids?.length > 0) {
      targets = calendar_ids.map(id => ({ id }));
    } else {
      targets = await getCalendars(req.accessToken, locationId);
    }

    for (const cal of targets) {
      const result = await pushThemeToCalendar(req.accessToken, cal.id, savedTheme);
      pushResults.push({ calendarId: cal.id, name: cal.name, ...result });
      if (!result.ok) {
        console.warn(`[Themes] Failed to push to calendar ${cal.id}:`, result.detail);
      }
    }

    const failCount = pushResults.filter(r => !r.ok).length;

    res.json({
      ok: true,
      message: 'Theme saved.',
      css_pushed: pushResults.filter(r => r.ok).length,
      failed: failCount,
      push_results: pushResults,
      ...(failCount > 0 ? { warning: `${failCount} calendar(s) could not be updated. Your calendar must use the Neo widget — check Settings > Calendars > Edit > Widget Type.` } : {}),
    });
  } catch (err) {
    console.error('[Themes] Push error:', err.message);
    res.json({
      ok: true,
      message: 'Theme saved to DB.',
      warning: 'Could not push to calendars: ' + err.message,
      push_results: pushResults,
    });
  }
});

// GET /theme.css?locationId=xxx
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