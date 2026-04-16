const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { themeQueries } = require('../db');

// GET /api/themes/:locationId — list all themes
router.get('/:locationId', requireLocation, (req, res) => {
  const themes = themeQueries.list(req.params.locationId);
  res.json({ themes });
});

// POST /api/themes/:locationId — create new theme
router.post('/:locationId', requireLocation, (req, res) => {
  const { name, config } = req.body;
  const theme = themeQueries.create(req.params.locationId, name, config);
  res.status(201).json(theme);
});

// GET /api/themes/:locationId/:themeId — get single theme
router.get('/:locationId/:themeId', requireLocation, (req, res) => {
  const theme = themeQueries.get(req.params.themeId);
  if (!theme || theme.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  res.json(theme);
});

// PUT /api/themes/:locationId/:themeId — update theme
router.put('/:locationId/:themeId', requireLocation, (req, res) => {
  const { name, config } = req.body;
  const existing = themeQueries.get(req.params.themeId);
  if (!existing || existing.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  const updated = themeQueries.update(req.params.themeId, name, config);
  res.json(updated);
});

// DELETE /api/themes/:locationId/:themeId — delete theme
router.delete('/:locationId/:themeId', requireLocation, (req, res) => {
  const existing = themeQueries.get(req.params.themeId);
  if (!existing || existing.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  themeQueries.delete(req.params.themeId);
  res.json({ ok: true });
});

// POST /api/themes/:locationId/:themeId/duplicate — duplicate theme
router.post('/:locationId/:themeId/duplicate', requireLocation, (req, res) => {
  const existing = themeQueries.get(req.params.themeId);
  if (!existing || existing.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  const dup = themeQueries.duplicate(req.params.themeId, req.body.name);
  res.status(201).json(dup);
});

module.exports = router;
