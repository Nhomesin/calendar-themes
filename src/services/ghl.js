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

// Fetch a single form definition by id, best-effort. GHL's v2 public API doesn't
// officially document a /forms/{id} endpoint yet, so this may 404 — callers
// should handle null.
async function getForm(accessToken, formId) {
  const client = ghlClient(accessToken);
  try {
    const res = await client.get(`/forms/${formId}`);
    return res.data?.form || res.data || null;
  } catch {
    return null;
  }
}

// List forms for a location. Returns an array of form summaries (id, name, …).
async function listForms(accessToken, locationId) {
  const client = ghlClient(accessToken);
  try {
    const res = await client.get('/forms/', { params: { locationId } });
    return res.data?.forms || res.data || [];
  } catch {
    return [];
  }
}

// Location custom-field definitions. Used to resolve the GHL ids + labels for
// fields that may appear in a calendar's form.
async function getLocationCustomFields(accessToken, locationId) {
  const client = ghlClient(accessToken);
  try {
    const res = await client.get('/locations/' + locationId + '/customFields');
    return res.data?.customFields || res.data || [];
  } catch {
    return [];
  }
}

// Normalize one of GHL's many field shapes into the renderer's
// { name, label, type, required, placeholder, options?, ghlId? }.
function normalizeGhlField(f) {
  if (!f) return null;
  const rawType = String(f.type || f.fieldType || f.dataType || f.dataTypeKey || 'text').toLowerCase();
  let type = 'text';
  if (rawType.includes('email')) type = 'email';
  else if (rawType.includes('phone') || rawType.includes('tel')) type = 'tel';
  else if (rawType.includes('textarea') || rawType.includes('paragraph') || rawType.includes('multiline') || rawType === 'large_text') type = 'textarea';
  else if (rawType.includes('select') || rawType.includes('dropdown') || rawType.includes('picklist') || rawType === 'single_options' || rawType === 'radio') type = 'select';
  else if (rawType.includes('number') || rawType === 'numerical') type = 'number';

  const name = f.fieldKey || f.key || f.name || f.id || f._id;
  if (!name) return null;

  const options = f.options || f.picklistOptions || f.picklist;
  return {
    name,
    label: f.label || f.title || f.name || name,
    type,
    required: !!(f.required || f.isRequired),
    placeholder: f.placeholder || '',
    ...(options ? { options: Array.isArray(options) ? options : [] } : {}),
    ...(f.id || f._id ? { ghlId: f.id || f._id } : {}),
  };
}

// Resolve the fields for the form attached to a calendar. GHL doesn't surface
// this cleanly in v2, so we try multiple shapes and fall back gracefully.
async function getCalendarFormFields(accessToken, locationId, calendarId) {
  try {
    const cal = await getCalendar(accessToken, calendarId);
    if (!cal) return null;

    // Option 1: calendar itself carries the field definitions inline.
    const inline =
      cal.formFields ||
      cal.customQuestions ||
      cal.questions ||
      (cal.form && cal.form.fields);
    if (Array.isArray(inline) && inline.length) {
      const mapped = inline.map(normalizeGhlField).filter(Boolean);
      if (mapped.length) return mapped;
    }

    // Option 2: calendar references a form id — try to fetch the form directly.
    const formId = cal.formId || cal.customFormId || (cal.form && cal.form.id);
    if (formId) {
      const form = await getForm(accessToken, formId);
      const fields =
        form && (form.fields || form.customFields || form.formFields);
      if (Array.isArray(fields) && fields.length) {
        const mapped = fields.map(normalizeGhlField).filter(Boolean);
        if (mapped.length) return mapped;
      }
    }

    return null;
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
  getForm,
  listForms,
  getFreeSlots,
  createContact,
  createAppointment,
  getInstalledLocations,
  getLocationTokenFromCompany,
};
