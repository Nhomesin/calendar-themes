/**
 * Compiles a stored theme config into CSS that targets
 * GHL calendar widget internals.
 *
 * These class names are from GHL's live widget DOM as of 2025.
 * GHL renders the booking widget as a Vue/React app — we target
 * the stable class prefixes and CSS custom properties it exposes.
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
/* CalTheme — injected via API */

/* ── CSS variables ── */
:root {
  --ct-primary:   ${primary_color};
  --ct-bg:        ${bg_color};
  --ct-text:      ${text_color};
  --ct-btn:       ${button_color};
  --ct-btn-text:  ${button_text};
  --ct-font:      ${font_family};
  --ct-radius:    ${r}px;
}

/* ── Page / wrapper ── */
body, html, #app, #booking-widget-app, .hl-page-wrap {
  background-color: ${bg_color} !important;
  font-family: ${font_family} !important;
  color: ${text_color} !important;
}

/* ── Calendar header (month + nav) ── */
.c-calendar-header,
.calendar-header,
[class*="calendar-header"],
[class*="month-selector"] {
  background-color: ${primary_color} !important;
  color: #ffffff !important;
  border-radius: ${r}px ${r}px 0 0 !important;
}

/* ── Navigation arrows ── */
.c-calendar-header button,
[class*="calendar-header"] button,
[class*="nav-button"],
[class*="prev-btn"],
[class*="next-btn"] {
  color: #ffffff !important;
  background: rgba(255,255,255,0.15) !important;
  border-radius: ${Math.round(r * 0.6)}px !important;
}

/* ── Day grid ── */
.c-day-wrap,
[class*="day-wrap"],
[class*="calendar-day"] {
  font-family: ${font_family} !important;
  color: ${text_color} !important;
}

/* ── Selected day ── */
.c-day-wrap.active,
[class*="day-wrap"].active,
[class*="day--selected"],
[class*="selected-day"],
.rdp-day_selected {
  background-color: ${primary_color} !important;
  color: #ffffff !important;
  border-radius: ${Math.round(r * 0.6)}px !important;
}

/* ── Today ── */
.c-day-wrap.today,
[class*="day--today"],
.rdp-day_today:not(.rdp-day_selected) {
  border: 2px solid ${primary_color} !important;
  border-radius: ${Math.round(r * 0.6)}px !important;
  color: ${primary_color} !important;
}

/* ── Time slots ── */
.c-time-slot,
[class*="time-slot"],
[class*="slot-item"],
[class*="time-item"] {
  border: 1.5px solid ${primary_color} !important;
  color: ${primary_color} !important;
  border-radius: ${Math.round(r * 0.6)}px !important;
  background: transparent !important;
  font-family: ${font_family} !important;
  transition: background 0.15s, color 0.15s !important;
}

.c-time-slot:hover,
[class*="time-slot"]:hover,
[class*="slot-item"]:hover,
[class*="time-item"].active,
[class*="time-item--selected"] {
  background-color: ${primary_color} !important;
  color: #ffffff !important;
}

/* ── CTA / submit button ── */
button[type="submit"],
.c-submit-btn,
[class*="submit-btn"],
[class*="confirm-btn"],
[class*="cta-btn"],
[class*="book-btn"],
[class*="next-btn"]:not([class*="calendar"]):not([class*="nav"]) {
  background-color: ${button_color} !important;
  color: ${button_text} !important;
  border-color: ${button_color} !important;
  border-radius: ${r}px !important;
  font-family: ${font_family} !important;
}

button[type="submit"]:hover,
[class*="submit-btn"]:hover {
  filter: brightness(0.9) !important;
}

/* ── Form inputs ── */
input[type="text"],
input[type="email"],
input[type="tel"],
input[type="number"],
textarea, select {
  border-radius: ${Math.round(r * 0.6)}px !important;
  border-color: ${primary_color}66 !important;
  font-family: ${font_family} !important;
  color: ${text_color} !important;
  background-color: ${bg_color} !important;
}

input:focus, textarea:focus, select:focus {
  outline-color: ${primary_color} !important;
  border-color: ${primary_color} !important;
  box-shadow: 0 0 0 2px ${primary_color}33 !important;
}

/* ── Step indicator / progress ── */
[class*="step-indicator"] .active,
[class*="progress-step"].active,
[class*="stepper"] .active {
  background-color: ${primary_color} !important;
  color: #ffffff !important;
}

/* ── Custom CSS passthrough ── */
${custom_css}
`.trim();
}

module.exports = { compileTheme };