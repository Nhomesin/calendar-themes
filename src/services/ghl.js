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

// Push theme to a calendar using GHL's native widgetCustomization fields.
// This works with the Neo widget and is the correct API approach.
async function pushThemeToCalendar(accessToken, calendarId, theme) {
  const client = ghlClient(accessToken);

  // First fetch the calendar to preserve existing settings
  let existing = {};
  try {
    const cal = await getCalendar(accessToken, calendarId);
    existing = cal?.widgetCustomization || {};
  } catch (_) {}

  const payload = {
    widgetCustomization: {
      ...existing,
      // GHL's native color fields (Neo widget)
      primaryColor:   theme.primary_color,
      bgColor:        theme.bg_color,
      // Button text label (optional)
      ...(existing.buttonText ? {} : { buttonText: 'Book Appointment' }),
    },
  };

  try {
    const res = await client.put(`/calendars/${calendarId}`, payload);
    return { ok: true, data: res.data };
  } catch (err) {
    const status = err?.response?.status;
    const detail = err?.response?.data;
    console.error(`[GHL] pushThemeToCalendar failed for ${calendarId} (${status}):`, JSON.stringify(detail));
    return { ok: false, status, detail };
  }
}

module.exports = { getCalendars, getCalendar, getLocation, pushThemeToCalendar };