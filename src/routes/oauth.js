const router = require('express').Router();
const axios = require('axios');
const { companyQueries, locationQueries } = require('../db');
const {
  getLocation,
  getInstalledLocations,
  getLocationTokenFromCompany,
} = require('../services/ghl');

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

// appId is the 24-hex prefix of client_id (`{appId}-{clientKey}`). Required
// by /oauth/installedLocations to list the agency's approved sub-accounts.
const GHL_APP_ID = process.env.GHL_APP_ID || (GHL_CLIENT_ID || '').split('-')[0];

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

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
//
// Handles both install paths:
//   • Sub-account install → token userType === 'Location' → save one location.
//   • Agency bulk install → token userType === 'Company'  → save the company,
//     then fan out to every approved sub-account and save a location row per.
router.get('/callback', async (req, res) => {
  const { code, locationId } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code from GHL.');
  }

  try {
    // Note: we intentionally don't force user_type here. GHL picks Location
    // or Company based on the Marketplace app's Distribution setting + who's
    // installing. We branch on the response below.
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

    const data = tokenRes.data || {};
    const userType = data.userType || data.user_type || null;

    if (userType === 'Company') {
      const result = await handleAgencyInstall(data);
      return res.redirect(
        `${APP_BASE_URL}/installed?companyId=${result.companyId}&locations=${result.locationCount}`
      );
    }

    // Default path: single sub-account install.
    const resolvedLocationId = locationId || data.locationId;
    if (!resolvedLocationId) {
      const diagnostic = {
        query_location_id: locationId || null,
        token_response_keys: Object.keys(data),
        companyId: data.companyId || null,
        userType,
      };
      console.error('[OAuth] No locationId resolvable:', diagnostic);
      return res.status(400).send(
        `Could not determine locationId from GHL response. Diagnostic: ${JSON.stringify(diagnostic)}`
      );
    }

    const locationName = await safeGetLocationName(data.access_token, resolvedLocationId);

    await locationQueries.upsert({
      location_id: resolvedLocationId,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: nowEpoch() + (data.expires_in || 86400),
      company_id: data.companyId || null,
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

// Agency bulk install: store the company token, list all approved sub-accounts,
// mint a location-scoped token for each, and upsert a locations row per.
// Per-location failures are logged and skipped — a single bad sub-account
// shouldn't kill the whole install.
async function handleAgencyInstall(tokenData) {
  const {
    access_token,
    refresh_token,
    expires_in,
    companyId,
    installToFutureLocations,
  } = tokenData;

  if (!companyId) {
    throw new Error('Company install returned no companyId');
  }

  await companyQueries.upsert({
    company_id: companyId,
    access_token,
    refresh_token,
    token_expires_at: nowEpoch() + (expires_in || 86400),
    company_name: null,
    install_to_future: !!installToFutureLocations,
  });

  console.log(`[OAuth] Agency install for company: ${companyId} (installToFuture=${!!installToFutureLocations})`);

  if (!GHL_APP_ID) {
    console.warn('[OAuth] GHL_APP_ID is not resolvable from GHL_CLIENT_ID — skipping sub-account fan-out.');
    return { companyId, locationCount: 0 };
  }

  let installed;
  try {
    installed = await getInstalledLocations(access_token, companyId, GHL_APP_ID);
  } catch (err) {
    console.error('[OAuth] getInstalledLocations failed:', err?.response?.data || err.message);
    return { companyId, locationCount: 0 };
  }

  let saved = 0;
  for (const loc of installed) {
    const locationId = loc._id || loc.id || loc.locationId;
    if (!locationId) continue;

    try {
      const locToken = await getLocationTokenFromCompany(access_token, companyId, locationId);
      await locationQueries.upsert({
        location_id: locationId,
        access_token: locToken.access_token,
        refresh_token: locToken.refresh_token,
        token_expires_at: nowEpoch() + (locToken.expires_in || 86400),
        company_id: companyId,
        location_name: loc.name || null,
      });
      saved++;
    } catch (err) {
      console.error(
        `[OAuth] Failed to provision location ${locationId}:`,
        err?.response?.data || err.message
      );
    }
  }

  console.log(`[OAuth] Agency ${companyId} — provisioned ${saved}/${installed.length} sub-accounts`);
  return { companyId, locationCount: saved };
}

async function safeGetLocationName(accessToken, locationId) {
  try {
    const loc = await getLocation(accessToken, locationId);
    return loc?.name || null;
  } catch (_) {
    return null;
  }
}

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

  await locationQueries.updateTokens({
    location_id: location.location_id,
    access_token,
    refresh_token,
    token_expires_at: Math.floor(Date.now() / 1000) + (expires_in || 86400),
  });

  return access_token;
}

module.exports = router;
module.exports.refreshAccessToken = refreshAccessToken;