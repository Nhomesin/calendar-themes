const router = require('express').Router();
const { requireLocation } = require('../middleware/auth');
const { getFreeSlots, createContact, createAppointment } = require('../services/ghl');

// GET /api/slots/:locationId/:calendarId — proxy GHL free-slots
router.get('/slots/:locationId/:calendarId', requireLocation, async (req, res) => {
  const { locationId, calendarId } = req.params;
  const { startDate, endDate, timezone } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }

  try {
    const raw = await getFreeSlots(
      req.accessToken,
      calendarId,
      locationId,
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

// POST /api/book/:locationId/:calendarId — create contact + appointment
router.post('/book/:locationId/:calendarId', requireLocation, async (req, res) => {
  const { calendarId, locationId } = req.params;
  const { name, email, phone, notes, startTime, endTime, timezone } = req.body;

  if (!email || !startTime || !endTime) {
    return res.status(400).json({ error: 'email, startTime, and endTime are required' });
  }

  // Split name into first/last
  const parts = (name || '').trim().split(/\s+/);
  const firstName = parts[0] || 'Guest';
  const lastName = parts.slice(1).join(' ') || '';

  try {
    // 1. Create or find contact
    let contactId;
    try {
      const contact = await createContact(req.accessToken, locationId, {
        firstName,
        lastName,
        email,
        phone: phone || '',
        timezone: timezone || 'America/New_York',
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
      title: `Booking by ${firstName} ${lastName}`.trim(),
      notes: notes || '',
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
