const axios = require('axios');

const GHL_API_BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

function ghlClient(accessToken) {
  return axios.create({
    baseURL: GHL_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: API_VERSION,
      'Content-Type': 'application/json',
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

async function updateCalendarSettings(accessToken, calendarId, customCss) {
  const client = ghlClient(accessToken);
  const res = await client.patch(`/calendars/${calendarId}`, {
    widgetSlug: undefined,
    customCss,
  });
  return res.data;
}

module.exports = { getCalendars, getLocation, updateCalendarSettings };
