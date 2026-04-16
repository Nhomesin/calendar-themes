/**
 * CalTheme Embed App
 *
 * Bootstraps the CalendarRenderer on the embed page.
 * Expects server-injected globals: SERVER_CALENDAR_ID, SERVER_LOCATION_ID,
 * SERVER_NAME, SERVER_THEME_CONFIG.
 */

(function () {
  'use strict';

  const calendarId = typeof SERVER_CALENDAR_ID !== 'undefined' ? SERVER_CALENDAR_ID : '';
  const locationId = typeof SERVER_LOCATION_ID !== 'undefined' ? SERVER_LOCATION_ID : '';
  const themeConfig = typeof SERVER_THEME_CONFIG !== 'undefined' ? SERVER_THEME_CONFIG : {};

  const container = document.getElementById('ct-root');

  if (!calendarId || !locationId) {
    container.innerHTML = `
      <div class="ct-loading">
        <div class="ct-confirm-icon" style="background:color-mix(in srgb, var(--ct-error) 12%, transparent)">!</div>
        <div class="ct-confirm-title">Invalid Booking Link</div>
        <div class="ct-confirm-msg">This booking link is missing required information.</div>
      </div>
    `;
    return;
  }

  const baseUrl = window.location.origin;

  // Fetch available time slots from the server proxy
  async function fetchSlots(startDate, endDate) {
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York');
    const url = `${baseUrl}/api/slots/${locationId}/${calendarId}?startDate=${startDate}&endDate=${endDate}&timezone=${tz}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load available times');
    return res.json();
  }

  // Submit booking through the server proxy
  async function submitBooking(formData) {
    const url = `${baseUrl}/api/book/${locationId}/${calendarId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.detail || 'Booking failed');
    return data;
  }

  // Boot the renderer
  const renderer = new CalendarRenderer(container, themeConfig, {
    previewMode: false,
    onFetchSlots: fetchSlots,
    onBook: submitBooking,
  });

  renderer.init();
})();
