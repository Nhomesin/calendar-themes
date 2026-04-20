const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { getCalendars, getCalendarGroups, getCalendarFormFields } = require('../services/ghl');

// GET /api/calendars/:locationId — list all calendars + groups for a location
router.get('/:locationId', requireLocation, async (req, res) => {
  try {
    const locationId = req.params.locationId;
    // Groups call is best-effort: some locations have none configured.
    const [calendars, groups] = await Promise.all([
      getCalendars(req.accessToken, locationId),
      getCalendarGroups(req.accessToken, locationId).catch(() => []),
    ]);
    res.json({ calendars, groups });
  } catch (err) {
    console.error('[Calendars] Fetch error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch calendars from GHL.' });
  }
});

// GET /api/calendars/:locationId/:calendarId/form — resolve the form attached
// to this calendar and return normalized field definitions for the renderer.
router.get('/:locationId/:calendarId/form', requireLocation, async (req, res) => {
  try {
    const { locationId, calendarId } = req.params;
    const fields = await getCalendarFormFields(req.accessToken, locationId, calendarId);
    res.json({ fields: fields || null });
  } catch (err) {
    console.error('[CalForm] Route error:', err?.response?.data || err.message);
    res.json({ fields: null });
  }
});

module.exports = router;