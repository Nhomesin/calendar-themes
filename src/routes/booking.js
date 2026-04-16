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
    const slots = await getFreeSlots(
      req.accessToken,
      calendarId,
      startDate,
      endDate,
      timezone || 'America/New_York'
    );
    res.json(slots);
  } catch (err) {
    console.error('[Slots] Fetch error:', err?.response?.data || err.message);
    res.status(502).json({ error: 'Failed to fetch available slots from GHL.' });
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
