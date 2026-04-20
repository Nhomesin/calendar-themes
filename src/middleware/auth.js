const { locationQueries } = require('../db');
const { refreshAccessToken } = require('../routes/oauth');

// Attaches req.location and req.accessToken to every protected route.
// Automatically refreshes the token if it expires within 5 minutes.

async function requireLocation(req, res, next) {
  const locationId = req.query.locationId || req.params.locationId || req.body?.locationId;

  if (!locationId) {
    return res.status(400).json({ error: 'locationId is required' });
  }

  const location = await locationQueries.get(locationId);

  if (!location) {
    return res.status(404).json({ error: 'Location not found. App may not be installed.' });
  }

  const expiresIn = location.token_expires_at - Math.floor(Date.now() / 1000);

  if (expiresIn < 300) {
    try {
      const newToken = await refreshAccessToken(location);
      req.accessToken = newToken;
    } catch (err) {
      console.error('[Auth] Token refresh failed:', err.message);
      return res.status(401).json({ error: 'Token refresh failed. User may need to reinstall.' });
    }
  } else {
    req.accessToken = location.access_token;
  }

  req.location = location;
  next();
}

module.exports = { requireLocation };