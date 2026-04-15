const router = require('express').Router();
const { locationQueries } = require('../db');

// GHL sends POST requests to these endpoints when installs/uninstalls happen.
// These act as a secondary safety net alongside the OAuth callback.

router.post('/install', (req, res) => {
  const { locationId, companyId } = req.body;
  console.log(`[Webhook] Install event received for location: ${locationId}`);
  // The OAuth callback already handles token storage.
  // This webhook is a backup signal — useful for logging or analytics.
  res.sendStatus(200);
});

router.post('/uninstall', (req, res) => {
  const { locationId } = req.body;

  if (locationId) {
    locationQueries.deactivate.run(locationId);
    console.log(`[Webhook] Uninstall — deactivated location: ${locationId}`);
  }

  res.sendStatus(200);
});

module.exports = router;
