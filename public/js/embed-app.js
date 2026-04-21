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

  async function fetchSlots(startDate, endDate, timezone) {
    const tz = encodeURIComponent(timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York');
    const url = `${baseUrl}/api/slots/${locationId}/${calendarId}?startDate=${startDate}&endDate=${endDate}&timezone=${tz}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load available times');
    return res.json();
  }

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

  // Fetch the form attached to this calendar. Best-effort: returns null when
  // GHL doesn't expose the form definition for this calendar.
  async function fetchCalendarForm() {
    try {
      const res = await fetch(`${baseUrl}/api/calendars/${locationId}/${calendarId}/form`);
      if (!res.ok) return null;
      const data = await res.json();
      return data && Array.isArray(data.fields) && data.fields.length ? data.fields : null;
    } catch {
      return null;
    }
  }

  // Decide which fields the booking form should render. Theme with
  // form.source === 'custom' always wins; otherwise prefer the calendar's
  // attached form, falling back to whatever the theme already specifies.
  function resolveFormFields(themeCfg, ghlFields) {
    const f = themeCfg.form || {};
    if (f.source === 'custom' && Array.isArray(f.fields) && f.fields.length) {
      return f.fields;
    }
    if (ghlFields && ghlFields.length) return ghlFields;
    return Array.isArray(f.fields) && f.fields.length ? f.fields : null;
  }

  // Emit our height to the parent so the pixel (or any iframe host) can
  // size us correctly. Namespaced message type so we don't collide with
  // GHL's own height protocol when multiple embeds are on the page.
  function postHeight() {
    try {
      const h = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0);
      if (h > 0 && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ct-embed-height', height: h }, '*');
      }
    } catch (_) { /* ignore */ }
  }

  (async function boot() {
    const ghlFields = await fetchCalendarForm();
    const fields = resolveFormFields(themeConfig, ghlFields);
    const mergedConfig = fields
      ? { ...themeConfig, form: { ...(themeConfig.form || {}), fields } }
      : themeConfig;

    const renderer = new CalendarRenderer(container, mergedConfig, {
      previewMode: false,
      onFetchSlots: fetchSlots,
      onBook: submitBooking,
    });
    renderer.init();

    // Initial + continuous height reporting.
    postHeight();
    window.addEventListener('load', postHeight);
    try {
      new ResizeObserver(postHeight).observe(document.body);
    } catch (_) {
      // Older browsers fall back to a periodic check.
      setInterval(postHeight, 500);
    }
  })();
})();
