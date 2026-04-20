const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { getFreeSlots, createContact, createAppointment } = require('../services/ghl');

// GET /api/slots/:locationId/:calendarId — proxy GHL free-slots
router.get('/slots/:locationId/:calendarId', requireLocation, async (req, res) => {
  const { calendarId } = req.params;
  const { startDate, endDate, timezone } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }

  try {
    const raw = await getFreeSlots(
      req.accessToken,
      calendarId,
      startDate,
      endDate,
      timezone || 'America/New_York'
    );
    console.log('[Slots] Raw GHL response keys:', JSON.stringify(Object.keys(raw || {})));
    console.log('[Slots] Sample:', JSON.stringify(raw).slice(0, 500));

    // Normalize GHL response into { "YYYY-MM-DD": ["iso1","iso2",...] }
    const normalized = {};
    // GHL may return { "YYYY-MM-DD": { slots: [...] } } or { slots: { ... } }
    const slotsObj = raw || {};
    const dateMap = slotsObj.slots || slotsObj;

    if (dateMap && typeof dateMap === 'object' && !Array.isArray(dateMap)) {
      for (const [key, val] of Object.entries(dateMap)) {
        // Skip non-date keys
        if (!/^\d{4}-\d{2}-\d{2}/.test(key)) continue;
        if (Array.isArray(val)) {
          normalized[key] = val;
        } else if (val && Array.isArray(val.slots)) {
          normalized[key] = val.slots;
        }
      }
    }

    res.json({ slots: normalized });
  } catch (err) {
    const detail = err?.response?.data || err.message;
    const status = err?.response?.status;
    console.error(`[Slots] Fetch error (HTTP ${status}):`, JSON.stringify(detail));
    res.status(502).json({ error: 'Failed to fetch available slots from GHL.', detail, ghlStatus: status });
  }
});

// Keys that map to standard GHL contact properties. Everything else in the
// submission body is treated as a custom field and forwarded via customFields.
const STANDARD_CONTACT_KEYS = new Set([
  'name', 'firstName', 'lastName', 'email', 'phone', 'notes', 'message',
  'startTime', 'endTime', 'timezone', 'title',
]);

// Reserved submission keys that must never be leaked into the GHL contact payload.
const IGNORED_KEYS = new Set([
  'startTime', 'endTime', 'timezone', 'title', 'notes', 'message',
]);

// Normalize a submission body into { contactFields, customFields, extras }.
//   contactFields -> firstName, lastName, email, phone
//   customFields  -> array of { id, key, value } for everything else
function splitSubmission(body) {
  const contactFields = {
    firstName: '',
    lastName: '',
    email: body.email || '',
    phone: body.phone || '',
  };

  if (body.firstName || body.lastName) {
    contactFields.firstName = (body.firstName || 'Guest').trim();
    contactFields.lastName = (body.lastName || '').trim();
  } else {
    const parts = (body.name || '').trim().split(/\s+/);
    contactFields.firstName = parts[0] || 'Guest';
    contactFields.lastName = parts.slice(1).join(' ') || '';
  }

  const customFields = [];
  for (const [key, value] of Object.entries(body || {})) {
    if (STANDARD_CONTACT_KEYS.has(key) || IGNORED_KEYS.has(key)) continue;
    if (value == null || value === '') continue;

    // GHL custom field ids are 24-char hex ObjectIds. Send id when we have one;
    // otherwise pass the key so GHL can match by field key.
    if (/^[a-f0-9]{24}$/i.test(key)) {
      customFields.push({ id: key, value });
    } else {
      customFields.push({ key, value });
    }
  }

  return { contactFields, customFields };
}

// POST /api/book/:locationId/:calendarId — create contact + appointment
router.post('/book/:locationId/:calendarId', requireLocation, async (req, res) => {
  const { calendarId, locationId } = req.params;
  const body = req.body || {};
  const { startTime, endTime, timezone } = body;

  if (!body.email || !startTime || !endTime) {
    return res.status(400).json({ error: 'email, startTime, and endTime are required' });
  }

  const { contactFields, customFields } = splitSubmission(body);

  try {
    // 1. Create or find contact
    let contactId;
    try {
      const contact = await createContact(req.accessToken, locationId, {
        firstName: contactFields.firstName,
        lastName: contactFields.lastName,
        email: contactFields.email,
        phone: contactFields.phone,
        timezone: timezone || 'America/New_York',
        customFields: customFields.length ? customFields : undefined,
      });
      contactId = contact.id || contact.contactId;
    } catch (err) {
      // GHL returns 400 with existing contact info if duplicate
      const existing = err?.response?.data;
      if (existing?.contactId) {
        contactId = existing.contactId;
      } else if (existing?.meta?.contactId) {
        contactId = existing.meta.contactId;
      } else {
        throw err;
      }
    }

    // 2. Create appointment
    const appointment = await createAppointment(req.accessToken, {
      calendarId,
      locationId,
      contactId,
      startTime,
      endTime,
      title: `Booking by ${contactFields.firstName} ${contactFields.lastName}`.trim(),
      notes: body.notes || body.message || '',
    });

    res.status(201).json({
      ok: true,
      appointmentId: appointment.id || appointment.eventId,
      contactId,
    });
  } catch (err) {
    console.error('[Book] Error:', err?.response?.data || err.message);
    res.status(502).json({
      error: 'Failed to create booking.',
      detail: err?.response?.data?.message || err.message,
    });
  }
});

module.exports = router;
