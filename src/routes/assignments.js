const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { assignmentQueries, themeQueries } = require('../db');

// GET /api/assignments/:locationId — list all assignments
router.get('/:locationId', requireLocation, (req, res) => {
  const assignments = assignmentQueries.list(req.params.locationId);
  res.json({ assignments });
});

// POST /api/assignments/:locationId — assign theme to calendar
router.post('/:locationId', requireLocation, (req, res) => {
  const { themeId, calendarId, calendarName } = req.body;

  if (!themeId || !calendarId) {
    return res.status(400).json({ error: 'themeId and calendarId are required' });
  }

  // Verify theme belongs to this location
  const theme = themeQueries.get(themeId);
  if (!theme || theme.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }

  const assignment = assignmentQueries.assign(
    req.params.locationId,
    themeId,
    calendarId,
    calendarName || null
  );
  res.status(201).json(assignment);
});

// DELETE /api/assignments/:locationId/:assignmentId — remove assignment
router.delete('/:locationId/:assignmentId', requireLocation, (req, res) => {
  assignmentQueries.unassign(req.params.assignmentId);
  res.json({ ok: true });
});

module.exports = router;
