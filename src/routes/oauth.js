const router = require('express').Router();
const axios = require('axios');
const { locationQueries } = require('../db');

const {
  GHL_CLIENT_ID,
  GHL_CLIENT_SECRET,
  GHL_REDIRECT_URI,
  APP_BASE_URL,
} = process.env;

// GHL has two separate base URLs:
// - consent screen (chooselocation) → marketplace.gohighlevel.com
// - token exchange & API calls      → services.leadconnectorhq.com
const GHL_AUTH_BASE = 'https://marketplace.gohighlevel.com';
const GHL_TOKEN_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// ── Step 1: Initiate OAuth install
router.get('/install', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: GHL_REDIRECT_URI,
    client_id: GHL_CLIENT_ID,
    scope: [
      'calendars.readonly',
      'calendars.write',
      'calendars/events.readonly',
      'calendars/events.write',
      'contacts.write',
      'locations.readonly',
    ].join(' '),
  });

  res.redirect(`${GHL_AUTH_BASE}/oauth/chooselocation?${params}`);
});

// ── Step 2: OAuth callback
router.get('/callback', async (req, res) => {
  const { code, locationId } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code from GHL.');
  }

  try {
    // Token exchange goes to services.leadconnectorhq.com, not marketplace
    const tokenRes = await axios.post(
      `${GHL_TOKEN_BASE}/oauth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: GHL_REDIRECT_URI,
        client_id: GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      }
    );

    const {
      access_token,
      refresh_token,
      expires_in,
      locationId: tokenLocationId,
      companyId,
    } = tokenRes.data;

    const resolvedLocationId = locationId || tokenLocationId;

    if (!resolvedLocationId) {
      return res.status(400).send('Could not determine locationId from GHL response.');
    }

    // Fetch location name for display purposes
    let locationName = null;
    try {
      const locRes = await axios.get(
        `${GHL_API_BASE}/locations/${resolvedLocationId}`,
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            Version: '2021-07-28',
            Accept: 'application/json',
          },
        }
      );
      locationName = locRes.data?.location?.name || null;
    } catch (_) {
      // Non-fatal
    }

    locationQueries.upsert({
      location_id: resolvedLocationId,
      access_token,
      refresh_token,
      token_expires_at: Math.floor(Date.now() / 1000) + (expires_in || 86400),
      company_id: companyId || null,
      location_name: locationName,
    });

    console.log(`[OAuth] Installed for location: ${resolvedLocationId} (${locationName})`);

    res.redirect(`${APP_BASE_URL}/installed?locationId=${resolvedLocationId}`);
  } catch (err) {
    const errData = err?.response?.data;
    console.error('[OAuth] Callback error:', typeof errData === 'object' ? JSON.stringify(errData) : errData || err.message);
    res.status(500).send(`OAuth install failed: ${JSON.stringify(err?.response?.data || err.message)}`);
  }
});

// ── Token refresh (internal helper)
async function refreshAccessToken(location) {
  const tokenRes = await axios.post(
    `${GHL_TOKEN_BASE}/oauth/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: location.refresh_token,
      client_id: GHL_CLIENT_ID,
      client_secret: GHL_CLIENT_SECRET,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
    }
  );

  const { access_token, refresh_token, expires_in } = tokenRes.data;

  locationQueries.updateTokens({
    location_id: location.location_id,
    access_token,
    refresh_token,
    token_expires_at: Math.floor(Date.now() / 1000) + (expires_in || 86400),
  });

  return access_token;
}

module.exports = router;
module.exports.refreshAccessToken = refreshAccessToken;