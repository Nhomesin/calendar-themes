const router = require('express').Router();
const { locationQueries } = require('../db');

// GHL sends ALL webhook events to a single URL.
// The event type is in req.body.type — branch on that.
router.post('/', (req, res) => {
  const { type, locationId, companyId } = req.body;

  console.log(`[Webhook] Event received: type=${type} locationId=${locationId}`);

  switch (type) {
    case 'INSTALL':
      // OAuth callback already stores the tokens.
      // This is a backup confirmation signal.
      console.log(`[Webhook] Install confirmed for location: ${locationId}`);
      break;

    case 'UNINSTALL':
      if (locationId) {
        locationQueries.deactivate(locationId);
        console.log(`[Webhook] Uninstall — deactivated location: ${locationId}`);
      }
      break;

    default:
      console.log(`[Webhook] Unhandled event type: ${type}`);
  }

  // Always respond 200 quickly — GHL will retry if you don't
  res.sendStatus(200);
});

module.exports = router;
