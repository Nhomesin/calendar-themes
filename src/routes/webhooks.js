const router = require('express').Router();
const { locationQueries } = require('../db');

// GHL sends ALL webhook events to a single URL.
// The event type is in req.body.type — branch on that.
router.post('/', async (req, res) => {
  const { type, locationId } = req.body;

  console.log(`[Webhook] Event received: type=${type} locationId=${locationId}`);

  try {
    switch (type) {
      case 'INSTALL':
        // OAuth callback already stores the tokens.
        // This is a backup confirmation signal.
        console.log(`[Webhook] Install confirmed for location: ${locationId}`);
        break;

      case 'UNINSTALL':
        if (locationId) {
          await locationQueries.deactivate(locationId);
          console.log(`[Webhook] Uninstall — deactivated location: ${locationId}`);
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

module.exports = router;
