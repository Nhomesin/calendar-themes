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

async function getFreeSlots(accessToken, calendarId, locationId, startDate, endDate, timezone) {
  const client = ghlClient(accessToken);
  const res = await client.get(`/calendars/${calendarId}/free-slots`, {
    params: { locationId, startDate, endDate, timezone },
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

module.exports = {
  getCalendars,
  getCalendar,
  getLocation,
  getFreeSlots,
  createContact,
  createAppointment,
};
