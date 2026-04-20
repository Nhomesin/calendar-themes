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

// List forms for a location. GHL's public v2 API only exposes { id, name,
// locationId } per form — there is no endpoint to read a form's field list.
async function listForms(accessToken, locationId) {
  const client = ghlClient(accessToken);
  try {
    const res = await client.get('/forms/', { params: { locationId } });
    return res.data?.forms || [];
  } catch {
    return [];
  }
}

// Location custom-field definitions for contacts. Scope:
// locations/customFields.readonly.
async function getLocationCustomFields(accessToken, locationId, model = 'contact') {
  const client = ghlClient(accessToken);
  try {
    const res = await client.get(`/locations/${locationId}/customFields`, {
      params: { model },
    });
    return res.data?.customFields || [];
  } catch (err) {
    console.warn('[CustomFields] Fetch error:', err?.response?.data || err.message);
    return [];
  }
}

// Map GHL's dataType strings (TEXT, LARGE_TEXT, PHONE, EMAIL, NUMERICAL,
// SINGLE_OPTIONS, RADIO, CHECKBOX, DROPDOWN, DATE, FILE_UPLOAD, TEXTBOX_LIST, …)
// onto the renderer's field types.
function mapDataType(t) {
  const s = String(t || '').toUpperCase();
  if (s === 'EMAIL') return 'email';
  if (s === 'PHONE') return 'tel';
  if (s === 'LARGE_TEXT' || s === 'MULTILINE' || s === 'TEXTAREA') return 'textarea';
  if (s === 'SINGLE_OPTIONS' || s === 'DROPDOWN' || s === 'RADIO') return 'select';
  if (s === 'NUMERICAL' || s === 'NUMBER') return 'number';
  return 'text';
}

// Normalize a location custom field (GHL CustomFieldSchema) into our renderer
// shape. fieldKey is used as the field name so submission values flow back to
// GHL with the correct mapping; ghlId is kept so the booking route can prefer
// the id on createContact.
function normalizeLocationCustomField(f) {
  if (!f) return null;
  const key = f.fieldKey || f.name || f.id;
  if (!key) return null;
  return {
    name: key,
    label: f.name || key,
    type: mapDataType(f.dataType),
    required: false, // GHL's custom-field schema doesn't carry form-level required flags.
    placeholder: f.placeholder || '',
    ...(Array.isArray(f.picklistOptions) && f.picklistOptions.length
      ? { options: f.picklistOptions }
      : {}),
    ...(f.id ? { ghlId: f.id } : {}),
  };
}

// Standard contact fields a calendar's booking form always collects.
function standardContactFields() {
  return [
    { name: 'firstName', label: 'First name', type: 'text', required: true, placeholder: 'Jane' },
    { name: 'lastName',  label: 'Last name',  type: 'text', required: false, placeholder: 'Doe' },
    { name: 'email',     label: 'Email',      type: 'email', required: true, placeholder: 'jane@example.com' },
    { name: 'phone',     label: 'Phone',      type: 'tel',   required: false, placeholder: '+1 (555) 000-0000' },
  ];
}

// Resolve the fields a calendar's form should render. GHL's public API does
// NOT expose which custom fields are bound to a particular form, so the best
// we can do is return the standard contact fields plus every contact-scoped
// custom field defined on the location. Callers fall back to the theme's
// configured fields when this returns null.
async function getCalendarFormFields(accessToken, locationId, calendarId) {
  try {
    // Pull the calendar only to confirm it exists / has a form attached.
    // formId isn't currently load-bearing (no public endpoint reads a form's
    // fields) but we keep the call so we return null when the calendar has no
    // form configured.
    const cal = await getCalendar(accessToken, calendarId);
    if (!cal) return null;

    const customs = await getLocationCustomFields(accessToken, locationId, 'contact');
    const customFields = (customs || [])
      .map(normalizeLocationCustomField)
      .filter(Boolean);

    return [...standardContactFields(), ...customFields];
  } catch (err) {
    console.warn('[CalForm] Fetch error:', err?.response?.data || err.message);
    return null;
  }
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

async function createContact(accessToken, locationId, { firstName, lastName, email, phone, timezone, customFields }) {
  const client = ghlClient(accessToken);
  const res = await client.post('/contacts/', {
    locationId,
    firstName,
    lastName,
    email,
    phone: phone || undefined,
    timezone: timezone || undefined,
    customFields: Array.isArray(customFields) && customFields.length ? customFields : undefined,
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
  getCalendarFormFields,
  getLocation,
  getLocationCustomFields,
  listForms,
  getFreeSlots,
  createContact,
  createAppointment,
  getInstalledLocations,
  getLocationTokenFromCompany,
};
