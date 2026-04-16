const router = require('express').Router();
const axios = require('axios');
const { locationQueries } = require('../db');

const {
  GHL_CLIENT_ID,
  GHL_CLIENT_SECRET,
  GHL_REDIRECT_URI,
  GHL_AUTH_BASE,
  GHL_API_BASE,
  APP_BASE_URL,
} = process.env;

// ── Step 1: Initiate OAuth install
// GHL calls this when a user clicks "Install" on your Marketplace listing.
// We redirect them to GHL's OAuth consent screen.
router.get('/install', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: GHL_REDIRECT_URI,
    client_id: GHL_CLIENT_ID,
    scope: [
      'calendars.readonly',
      'calendars.write',
      'locations.readonly',
    ].join(' '),
  });

  res.redirect(`${GHL_AUTH_BASE}/oauth/chooselocation?${params}`);
});

// ── Step 2: OAuth callback
// GHL redirects here after the user approves the install.
// We exchange the code for tokens and store them.
router.get('/callback', async (req, res) => {
  const { code, locationId } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code from GHL.');
  }

  try {
    // Exchange auth code for access + refresh tokens
    const tokenRes = await axios.post(
      `${GHL_AUTH_BASE}/oauth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: GHL_REDIRECT_URI,
        client_id: GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
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
        { headers: { Authorization: `Bearer ${access_token}`, Version: '2021-07-28' } }
      );
      locationName = locRes.data?.location?.name || null;
    } catch (_) {
      // Non-fatal — we can live without the name
    }

    // Store tokens in DB
    locationQueries.upsert.run({
      location_id: resolvedLocationId,
      access_token,
      refresh_token,
      token_expires_at: Math.floor(Date.now() / 1000) + expires_in,
      company_id: companyId || null,
      location_name: locationName,
    });

    console.log(`[OAuth] Installed for location: ${resolvedLocationId} (${locationName})`);

    // Redirect to post-install success page
    res.redirect(`${APP_BASE_URL}/installed?locationId=${resolvedLocationId}`);
  } catch (err) {
    console.error('[OAuth] Callback error:', err?.response?.data || err.message);
    res.status(500).send('OAuth install failed. Check server logs.');
  }
});

// ── Token refresh helper (called internally, not a user-facing route)
async function refreshAccessToken(location) {
  const tokenRes = await axios.post(
    `${GHL_AUTH_BASE}/oauth/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: location.refresh_token,
      client_id: GHL_CLIENT_ID,
      client_secret: GHL_CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = tokenRes.data;

  locationQueries.updateTokens.run({
    location_id: location.location_id,
    access_token,
    refresh_token,
    token_expires_at: Math.floor(Date.now() / 1000) + expires_in,
  });

  return access_token;
}

module.exports = router;
module.exports.refreshAccessToken = refreshAccessToken;
