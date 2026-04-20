const axios = require('axios');

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION  = '2021-07-28';

function ghlClient(accessToken) {
  return axios.create({
    baseURL: GHL_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

async function getCalendars(accessToken, locationId) {
  const client = ghlClient(accessToken);
  const res = await client.get('/calendars/', { params: { locationId } });
  return res.data?.calendars || [];
}

async function getCalendarGroups(accessToken, locationId) {
  const client = ghlClient(accessToken);
  const res = await client.get('/calendars/groups', { params: { locationId } });
  return res.data?.groups || [];
}

async function getLocation(accessToken, locationId) {
  const client = ghlClient(accessToken);
  const res = await client.get(`/locations/${locationId}`);
  return res.data?.location || null;
}

async function getCalendar(accessToken, calendarId) {
  const client = ghlClient(accessToken);
  const res = await client.get(`/calendars/${calendarId}`);
  return res.data?.calendar || res.data || null;
}

async function getFreeSlots(accessToken, calendarId, startDate, endDate, timezone) {
  const client = ghlClient(accessToken);

  // GHL expects Unix timestamps in milliseconds, not date strings
  const startMs = new Date(startDate + 'T00:00:00').getTime();
  const endMs   = new Date(endDate + 'T23:59:59').getTime();

  const res = await client.get(`/calendars/${calendarId}/free-slots`, {
    params: {
      startDate: startMs,
      endDate: endMs,
      timezone,
    },
  });
  return res.data || {};
}

async function createContact(accessToken, locationId, { firstName, lastName, email, phone, timezone }) {
  const client = ghlClient(accessToken);
  const res = await client.post('/contacts/', {
    locationId,
    firstName,
    lastName,
    email,
    phone: phone || undefined,
    timezone: timezone || undefined,
  });
  return res.data?.contact || res.data || {};
}

async function createAppointment(accessToken, { calendarId, locationId, contactId, startTime, endTime, title, notes }) {
  const client = ghlClient(accessToken);
  const res = await client.post('/calendars/events/appointments', {
    calendarId,
    locationId,
    contactId,
    startTime,
    endTime,
    title: title || 'Appointment',
    appointmentStatus: 'confirmed',
    ...(notes ? { notes } : {}),
  });
  return res.data || {};
}

// ── Agency (company-level) helpers ─────────────────────────────────────────

// List every sub-account the agency has approved for this app.
// Paginates internally; returns the full list.
async function getInstalledLocations(companyAccessToken, companyId, appId) {
  const client = ghlClient(companyAccessToken);
  const out = [];
  const limit = 200;
  let skip = 0;

  // Defensive cap — real agencies top out well below this.
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.get('/oauth/installedLocations', {
      params: { companyId, appId, limit, skip, isInstalled: true },
    });
    const batch = res.data?.locations || [];
    out.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
  }

  return out;
}

// Exchange a company-level access token for a location-scoped token.
// This is how an agency-installed app gets per-sub-account credentials.
async function getLocationTokenFromCompany(companyAccessToken, companyId, locationId) {
  // This endpoint insists on form-encoded, not JSON — so we can't reuse ghlClient.
  const res = await axios.post(
    `${GHL_API_BASE}/oauth/locationToken`,
    new URLSearchParams({ companyId, locationId }),
    {
      headers: {
        Authorization: `Bearer ${companyAccessToken}`,
        Version: API_VERSION,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    }
  );
  return res.data;
}

module.exports = {
  getCalendars,
  getCalendarGroups,
  getCalendar,
  getLocation,
  getFreeSlots,
  createContact,
  createAppointment,
  getInstalledLocations,
  getLocationTokenFromCompany,
};
