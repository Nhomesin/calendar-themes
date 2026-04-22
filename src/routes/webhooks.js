const router = require('express').Router();
const { companyQueries, locationQueries } = require('../db');

// GHL sends ALL webhook events to a single URL.
// The event type is in req.body.type — branch on that.
router.post('/', async (req, res) => {
  const { type, locationId, companyId } = req.body;

  console.log(`[Webhook] Event received: type=${type} locationId=${locationId || '-'} companyId=${companyId || '-'}`);

  try {
    switch (type) {
      case 'INSTALL':
        // OAuth callback already stores the tokens.
        // This is a backup confirmation signal.
        console.log(`[Webhook] Install confirmed (locationId=${locationId || '-'}, companyId=${companyId || '-'})`);
        break;

      case 'UNINSTALL':
        // An UNINSTALL carries one of locationId or companyId depending on
        // the install scope. Deactivate whichever was supplied.
        if (locationId) {
          await locationQueries.deactivate(locationId);
          console.log(`[Webhook] Uninstall — deactivated location: ${locationId}`);
        }
        if (companyId) {
          await companyQueries.deactivate(companyId);
          console.log(`[Webhook] Uninstall — deactivated company: ${companyId}`);
        }
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${type}`);
    }
  } catch (err) {
    console.error('[Webhook] Handler error:', err.message);
    // Still 200 so GHL doesn't retry a DB failure we've already logged.
  }

  res.sendStatus(200);
});

// Paddle webhook — placeholder endpoint, returns 200 so Paddle treats
// it as successfully delivered. Real handling to be added later.
router.post('/paddle', (req, res) => {
  res.sendStatus(200);
});

module.exports = router;
