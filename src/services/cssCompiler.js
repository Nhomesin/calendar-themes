/**
 * Compiles a stored theme config object into a CSS string
 * targeting GHL calendar widget class names.
 *
 * Usage:
 *   const css = compileTheme(themeRow);
 *   res.setHeader('Content-Type', 'text/css');
 *   res.send(css);
 */
function compileTheme(theme) {
  const {
    primary_color  = '#6C63FF',
    bg_color       = '#FFFFFF',
    text_color     = '#1A1A1A',
    button_color   = '#6C63FF',
    button_text    = '#FFFFFF',
    font_family    = 'Inter, sans-serif',
    border_radius  = 8,
    custom_css     = '',
  } = theme || {};

  const r = parseInt(border_radius, 10) || 8;

  return `
/* ── CalTheme — generated, do not edit manually ── */

/* CSS variables — available to all child elements */
:root {
  --ct-primary:       ${primary_color};
  --ct-bg:            ${bg_color};
  --ct-text:          ${text_color};
  --ct-btn:           ${button_color};
  --ct-btn-text:      ${button_text};
  --ct-font:          ${font_family};
  --ct-radius:        ${r}px;
}

/* Wrapper page */
body, html {
  background-color: var(--ct-bg) !important;
  font-family: var(--ct-font) !important;
  color: var(--ct-text) !important;
}

/* ── GHL Calendar Widget class overrides ── */

/* Main container */
.calendar-widget-container,
.booking-widget-container,
[class*="calendar-widget"],
[class*="booking-widget"] {
  background-color: var(--ct-bg) !important;
  font-family: var(--ct-font) !important;
  color: var(--ct-text) !important;
  border-radius: var(--ct-radius) !important;
}

/* Date picker header */
.calendar-header,
[class*="cal-header"],
[class*="month-header"] {
  background-color: var(--ct-primary) !important;
  color: #fff !important;
  border-radius: var(--ct-radius) var(--ct-radius) 0 0 !important;
}

/* Selected day */
.day-selected,
[class*="day-selected"],
[class*="selected-day"],
.rdp-day_selected {
  background-color: var(--ct-primary) !important;
  color: #fff !important;
  border-radius: calc(var(--ct-radius) / 2) !important;
}

/* Today indicator */
.day-today,
[class*="day-today"],
.rdp-day_today {
  border: 2px solid var(--ct-primary) !important;
  border-radius: calc(var(--ct-radius) / 2) !important;
}

/* Available time slots */
.time-slot,
[class*="time-slot"],
[class*="slot-available"] {
  border: 1px solid var(--ct-primary) !important;
  color: var(--ct-primary) !important;
  border-radius: calc(var(--ct-radius) / 2) !important;
  transition: background-color 0.15s, color 0.15s;
}

.time-slot:hover,
[class*="time-slot"]:hover {
  background-color: var(--ct-primary) !important;
  color: #fff !important;
}

/* Primary CTA button */
button[type="submit"],
.btn-primary,
[class*="btn-primary"],
[class*="submit-btn"],
[class*="confirm-btn"],
[class*="book-btn"] {
  background-color: var(--ct-btn) !important;
  color: var(--ct-btn-text) !important;
  border-color: var(--ct-btn) !important;
  border-radius: var(--ct-radius) !important;
  font-family: var(--ct-font) !important;
}

button[type="submit"]:hover,
.btn-primary:hover {
  filter: brightness(0.92);
}

/* Form inputs */
input[type="text"],
input[type="email"],
input[type="tel"],
textarea,
select {
  border-radius: calc(var(--ct-radius) / 2) !important;
  border-color: color-mix(in srgb, var(--ct-primary) 40%, transparent) !important;
  font-family: var(--ct-font) !important;
  color: var(--ct-text) !important;
  background-color: var(--ct-bg) !important;
}

input:focus,
textarea:focus,
select:focus {
  outline-color: var(--ct-primary) !important;
  border-color: var(--ct-primary) !important;
}

/* Navigation arrows */
[class*="nav-btn"],
[class*="prev-month"],
[class*="next-month"],
.rdp-nav_button {
  color: var(--ct-primary) !important;
}

/* Progress / step indicator */
[class*="step-active"],
[class*="progress-active"] {
  background-color: var(--ct-primary) !important;
  color: #fff !important;
}

/* ── Custom CSS passthrough (user-authored, always last) ── */
${custom_css}
`.trim();
}

module.exports = { compileTheme };