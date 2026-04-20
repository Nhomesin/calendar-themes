// Single source of truth for the default theme config.
// Used by DB layer, API, builder, and embed.

function getDefaultConfig() {
  return {
    layout: {
      type: 'multi-step',           // 'multi-step' | 'single-page' | 'sidebar'
      stepsOrder: ['calendar', 'time', 'form', 'confirm'],
    },
    calendar: {
      view: 'month',
      firstDayOfWeek: 0,            // 0 = Sunday, 1 = Monday
      showWeekNumbers: false,
    },
    timeSlots: {
      style: 'pills',               // 'pills' | 'list' | 'grid'
      columns: 3,
    },
    colors: {
      primary: '#6C63FF',
      background: '#FFFFFF',
      text: '#1A1A1A',
      textMuted: '#6B7280',
      buttonBg: '#6C63FF',
      buttonText: '#FFFFFF',
      accent: '#6C63FF',
      border: '#E5E7EB',
      hoverBg: '#F3F4F6',
      selectedBg: '#6C63FF',
      selectedText: '#FFFFFF',
      todayRing: '#6C63FF',
      shadow: 'rgba(0,0,0,0.08)',
      error: '#EF4444',
      success: '#22C55E',
    },
    typography: {
      fontFamily: "'DM Sans', sans-serif",
      headingSize: '18px',
      bodySize: '14px',
      smallSize: '12px',
      fontWeight: '500',
      headingWeight: '600',
    },
    spacing: {
      borderRadius: 8,
      padding: 16,
      gap: 8,
      slotPadding: 10,
    },
    animations: {
      transitionSpeed: '0.2s',
      stepTransition: 'slide-left',  // 'slide-left' | 'fade' | 'none'
      hoverScale: false,
    },
    components: {
      showHeader: true,
      showProgressBar: true,
      showTimezone: true,
      showPoweredBy: true,
      headerText: 'Book an Appointment',
      confirmButtonText: 'Confirm Booking',
      successMessage: "You're all set! Check your email for confirmation.",
    },
    form: {
      // 'calendar' pulls fields live from the calendar's attached form in GHL.
      // 'custom' uses the fields[] below (edited in the builder).
      source: 'calendar',
      fields: [
        { name: 'name', label: 'Full Name', type: 'text', required: true, placeholder: 'John Doe' },
        { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'john@example.com' },
        { name: 'phone', label: 'Phone', type: 'tel', required: false, placeholder: '+1 (555) 000-0000' },
        { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Anything we should know...' },
      ],
    },
    customCss: '',
  };
}

// Deep-merge user config over defaults so missing keys always have values
function mergeWithDefaults(userConfig) {
  const defaults = getDefaultConfig();
  return deepMerge(defaults, userConfig || {});
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = { getDefaultConfig, mergeWithDefaults };
