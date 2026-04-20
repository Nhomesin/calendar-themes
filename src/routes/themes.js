const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { themeQueries } = require('../db');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// GET /api/themes/:locationId — list all themes
router.get('/:locationId', requireLocation, asyncHandler(async (req, res) => {
  const themes = await themeQueries.list(req.params.locationId);
  res.json({ themes });
}));

// POST /api/themes/:locationId — create new theme
router.post('/:locationId', requireLocation, asyncHandler(async (req, res) => {
  const { name, config } = req.body;
  const theme = await themeQueries.create(req.params.locationId, name, config);
  res.status(201).json(theme);
}));

// GET /api/themes/:locationId/:themeId — get single theme
router.get('/:locationId/:themeId', requireLocation, asyncHandler(async (req, res) => {
  const theme = await themeQueries.get(req.params.themeId);
  if (!theme || theme.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  res.json(theme);
}));

// PUT /api/themes/:locationId/:themeId — update theme
router.put('/:locationId/:themeId', requireLocation, asyncHandler(async (req, res) => {
  const { name, config } = req.body;
  const existing = await themeQueries.get(req.params.themeId);
  if (!existing || existing.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  const updated = await themeQueries.update(req.params.themeId, name, config);
  res.json(updated);
}));

// DELETE /api/themes/:locationId/:themeId — delete theme
router.delete('/:locationId/:themeId', requireLocation, asyncHandler(async (req, res) => {
  const existing = await themeQueries.get(req.params.themeId);
  if (!existing || existing.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  await themeQueries.delete(req.params.themeId);
  res.json({ ok: true });
}));

// POST /api/themes/:locationId/:themeId/duplicate — duplicate theme
router.post('/:locationId/:themeId/duplicate', requireLocation, asyncHandler(async (req, res) => {
  const existing = await themeQueries.get(req.params.themeId);
  if (!existing || existing.location_id !== req.params.locationId) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  const dup = await themeQueries.duplicate(req.params.themeId, req.body.name);
  res.status(201).json(dup);
}));

module.exports = router;
