const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { getCalendars, getCalendarGroups } = require('../services/ghl');

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

module.exports = router;