const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { getCalendars } = require('../services/ghl');

// GET /api/calendars/:locationId — list all calendars for a location
router.get('/:locationId', requireLocation, async (req, res) => {
  try {
    const calendars = await getCalendars(req.accessToken, req.params.locationId);
    res.json({ calendars });
  } catch (err) {
    console.error('[Calendars] Fetch error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch calendars from GHL.' });
  }
});

module.exports = router;