const router = require('express').Router();
const { assignmentQueries } = require('../db');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// POST /api/pixel/resolve — public, no auth
// Body:     { calendarIds: string[] }   (1..100, de-duped)
// Response: { resolved: { [calendarId]: { locationId, primaryColor } } }
router.post('/resolve', asyncHandler(async (req, res) => {
  const raw = req.body && req.body.calendarIds;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: 'calendarIds must be an array' });
  }

  const ids = Array.from(new Set(
    raw.filter((x) => typeof x === 'string')
       .map((x) => x.trim())
       .filter(Boolean)
  )).slice(0, 100);

  if (ids.length === 0) {
    return res.json({ resolved: {} });
  }

  const rows = await assignmentQueries.getByCalendarIds(ids);

  const resolved = {};
  for (const r of rows) {
    resolved[r.calendar_id] = {
      locationId: r.location_id,
      primaryColor: r.primary_color,
    };
  }

  res.set('Cache-Control', 'no-store');
  res.json({ resolved });
}));

module.exports = router;
