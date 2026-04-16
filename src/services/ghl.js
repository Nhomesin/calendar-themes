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

// Push compiled CSS into the calendar's widgetCustomization.customCss field.
// GHL applies this CSS inside the widget itself — solving the iframe styling problem.
async function pushCssToCalendar(accessToken, calendarId, css) {
  const client = ghlClient(accessToken);
  try {
    const res = await client.put(`/calendars/${calendarId}`, {
      widgetCustomization: {
        customCss: css,
      },
    });
    return { ok: true, data: res.data };
  } catch (err) {
    const status = err?.response?.status;
    const detail = err?.response?.data;
    console.error(`[GHL] pushCssToCalendar failed (${status}):`, JSON.stringify(detail));
    return { ok: false, status, detail };
  }
}

module.exports = { getCalendars, getLocation, pushCssToCalendar };