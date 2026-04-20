/**
 * CalTheme Calendar Renderer
 *
 * Shared rendering engine used by both the embed page and the builder preview.
 * All rendering is pure DOM manipulation — no framework.
 *
 * Usage:
 *   const renderer = new CalendarRenderer(container, config, { previewMode: false });
 *   renderer.init();
 */

// eslint-disable-next-line no-unused-vars
class CalendarRenderer {
  constructor(container, config, opts = {}) {
    this.container = container;
    this.config = config || {};
    this.previewMode = opts.previewMode || false;
    this.onBook = opts.onBook || null;       // async (formData) => result
    this.onFetchSlots = opts.onFetchSlots || null; // async (startDate, endDate) => slotsData

    // State
    this.currentYear = new Date().getFullYear();
    this.currentMonth = new Date().getMonth();
    this.selectedDate = null;
    this.selectedSlot = null;
    this.availableSlots = {};  // { 'YYYY-MM-DD': ['09:00','09:30',...] }
    this.slotCache = new Map(); // 'YYYY-MM' -> { data, ts }
    this.currentStep = 0;
    this.steps = (config.layout && config.layout.stepsOrder) || ['calendar', 'time', 'form', 'confirm'];
    this.isLoading = false;
    this.initialLoaded = false;  // first slot fetch hasn't resolved yet
    this.detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    this.timezone = this.loadSavedTimezone() || this.detectedTimezone;
    this.tzIsAuto = this.timezone === this.detectedTimezone && !this.hasSavedTimezone();

    // DOM refs
    this.els = {};
  }

  loadSavedTimezone() {
    try { return localStorage.getItem('ct-user-timezone') || null; } catch { return null; }
  }

  hasSavedTimezone() {
    try { return !!localStorage.getItem('ct-user-timezone'); } catch { return false; }
  }

  setTimezone(tz, { auto = false } = {}) {
    if (!tz || tz === this.timezone && auto === this.tzIsAuto) return;
    this.timezone = tz;
    this.tzIsAuto = auto;
    try {
      if (auto) localStorage.removeItem('ct-user-timezone');
      else localStorage.setItem('ct-user-timezone', tz);
    } catch {}

    this.slotCache.clear();
    this.availableSlots = {};

    if (this.previewMode) {
      this.render();
      this.loadMockSlots();
    } else {
      this.isLoading = true;
      this.initialLoaded = false;
      this.render();
      this.fetchSlotsForMonth(this.currentYear, this.currentMonth);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  init() {
    this.applyThemeVars();
    if (!this.previewMode) {
      // Show a clean loading state; don't render the full calendar until
      // initial slot data is back (prevents the empty-calendar flicker).
      this.isLoading = true;
      this.renderLoadingState();
      this.fetchSlotsForMonth(this.currentYear, this.currentMonth);
    } else {
      this.initialLoaded = true;
      this.render();
      this.loadMockSlots();
    }
  }

  renderLoadingState() {
    const app = el('div', '');
    app.id = 'ct-app';
    const wrap = el('div', 'ct-initial-loading');
    wrap.appendChild(el('div', 'ct-spinner'));
    const text = el('div', 'ct-loading-text');
    text.textContent = 'Loading availability…';
    wrap.appendChild(text);
    app.appendChild(wrap);
    this.container.replaceChildren(app);
  }

  updateConfig(newConfig) {
    this.config = newConfig;
    this.steps = (newConfig.layout && newConfig.layout.stepsOrder) || ['calendar', 'time', 'form', 'confirm'];
    this.applyThemeVars();
    this.render();
    if (this.previewMode) this.loadMockSlots();
  }

  // ── Theme CSS Variables ─────────────────────────────────────────────────

  applyThemeVars() {
    const c = this.config.colors || {};
    const t = this.config.typography || {};
    const s = this.config.spacing || {};
    const a = this.config.animations || {};

    const vars = {
      '--ct-primary':        c.primary || '#6C63FF',
      '--ct-bg':             c.background || '#FFFFFF',
      '--ct-text':           c.text || '#1A1A1A',
      '--ct-text-muted':     c.textMuted || '#6B7280',
      '--ct-btn-bg':         c.buttonBg || c.primary || '#6C63FF',
      '--ct-btn-text':       c.buttonText || '#FFFFFF',
      '--ct-accent':         c.accent || c.primary || '#6C63FF',
      '--ct-border':         c.border || '#E5E7EB',
      '--ct-hover-bg':       c.hoverBg || '#F3F4F6',
      '--ct-selected-bg':    c.selectedBg || c.primary || '#6C63FF',
      '--ct-selected-text':  c.selectedText || '#FFFFFF',
      '--ct-today-ring':     c.todayRing || c.primary || '#6C63FF',
      '--ct-shadow':         c.shadow || 'rgba(0,0,0,0.08)',
      '--ct-error':          c.error || '#EF4444',
      '--ct-success':        c.success || '#22C55E',
      '--ct-font':           t.fontFamily || "'DM Sans', system-ui, sans-serif",
      '--ct-heading-size':   t.headingSize || '18px',
      '--ct-body-size':      t.bodySize || '14px',
      '--ct-small-size':     t.smallSize || '12px',
      '--ct-font-weight':    t.fontWeight || '500',
      '--ct-heading-weight': t.headingWeight || '600',
      '--ct-radius':         (s.borderRadius ?? 8) + 'px',
      '--ct-padding':        (s.padding ?? 16) + 'px',
      '--ct-gap':            (s.gap ?? 8) + 'px',
      '--ct-slot-padding':   (s.slotPadding ?? 10) + 'px',
      '--ct-transition':     a.transitionSpeed || '0.2s',
    };

    // In preview mode, scope vars to the container; in embed mode, use :root
    const target = this.previewMode ? this.container : (this.container.closest('html') || document.documentElement);
    for (const [k, v] of Object.entries(vars)) {
      target.style.setProperty(k, v);
    }

    // Slot columns
    const cols = (this.config.timeSlots && this.config.timeSlots.columns) || 3;
    target.style.setProperty('--ct-slot-cols', cols);
  }

  // ── Main Render ─────────────────────────────────────────────────────────

  render() {
    // In real booking mode, don't render the full UI until initial slots have loaded
    if (!this.previewMode && !this.initialLoaded) {
      this.renderLoadingState();
      return;
    }

    const layout = (this.config.layout && this.config.layout.type) || 'multi-step';
    const comp = this.config.components || {};
    const hasCombined = this.steps.includes('calendar+time');

    // Create inner wrapper — never clobber the container's own class/id
    const classes = [];
    if (layout === 'sidebar')     classes.push('layout-sidebar');
    if (layout === 'single-page') classes.push('layout-single-page');
    if (hasCombined)              classes.push('flow-combined');

    const app = el('div', classes.join(' '));
    app.id = 'ct-app';

    // Header
    if (comp.showHeader !== false) {
      const header = el('div', 'ct-header');
      header.appendChild(el('div', 'ct-header-dot'));
      const title = el('span', 'ct-header-title');
      title.textContent = comp.headerText || 'Book an Appointment';
      header.appendChild(title);
      app.appendChild(header);
    }

    // Progress bar
    if (comp.showProgressBar !== false && layout === 'multi-step') {
      const progress = el('div', 'ct-progress');
      this.steps.forEach((_, i) => {
        const step = el('div', 'ct-progress-step');
        if (i <= this.currentStep) step.classList.add(i < this.currentStep ? 'done' : 'active');
        progress.appendChild(step);
      });
      this.els.progress = progress;
      app.appendChild(progress);
    }

    // Main
    const main = el('div', 'ct-main');
    this.els.main = main;

    // Build each step
    this.steps.forEach((stepName, i) => {
      const section = el('div', `ct-step ct-step-${stepName.replace('+', '-')}`);
      if (layout === 'multi-step') {
        if (i === this.currentStep) {
          section.classList.add('active');
          const anim = (this.config.animations && this.config.animations.stepTransition) || 'slide-left';
          if (anim !== 'none') section.classList.add(`animate-${anim}`);
        }
      } else {
        section.classList.add('active');
      }
      this.renderStep(section, stepName);
      main.appendChild(section);
    });

    app.appendChild(main);

    // Powered by
    if (comp.showPoweredBy !== false) {
      const powered = el('div', 'ct-powered');
      powered.textContent = 'Powered by CalTheme';
      app.appendChild(powered);
    }

    // Timezone selector
    if (comp.showTimezone !== false) {
      app.appendChild(this.buildTimezoneSelector());
    }

    // Atomic swap — prevents the blank-flash between renders
    this.container.replaceChildren(app);
    this.els.app = app;
  }

  renderStep(container, stepName) {
    switch (stepName) {
      case 'calendar':      this.renderCalendar(container); break;
      case 'time':          this.renderTimeSlots(container); break;
      case 'calendar+time': this.renderCalendarAndTime(container); break;
      case 'form':          this.renderForm(container); break;
      case 'confirm':       this.renderConfirmation(container); break;
    }
  }

  // ── Calendar Grid ───────────────────────────────────────────────────────

  renderCalendar(container) {
    const calConfig = this.config.calendar || {};
    const firstDay = calConfig.firstDayOfWeek || 0;

    // Navigation
    const nav = el('div', 'ct-cal-nav');
    const prevBtn = el('button', 'ct-cal-nav-btn');
    prevBtn.innerHTML = '&#8249;';
    prevBtn.onclick = () => this.navigateMonth(-1);
    const monthLabel = el('span', 'ct-cal-month');
    monthLabel.textContent = this.formatMonthYear(this.currentYear, this.currentMonth);
    const nextBtn = el('button', 'ct-cal-nav-btn');
    nextBtn.innerHTML = '&#8250;';
    nextBtn.onclick = () => this.navigateMonth(1);
    nav.appendChild(prevBtn);
    nav.appendChild(monthLabel);
    nav.appendChild(nextBtn);
    container.appendChild(nav);

    // Weekday headers
    const weekdays = el('div', 'ct-cal-weekdays');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
      const d = el('div', 'ct-cal-weekday');
      d.textContent = dayNames[(i + firstDay) % 7];
      weekdays.appendChild(d);
    }
    container.appendChild(weekdays);

    // Day grid
    const days = el('div', 'ct-cal-days');
    const firstOfMonth = new Date(this.currentYear, this.currentMonth, 1);
    const startDow = (firstOfMonth.getDay() - firstDay + 7) % 7;
    const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
    const today = new Date();

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
      days.appendChild(el('div', 'ct-cal-day empty'));
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dayEl = el('button', 'ct-cal-day');
      dayEl.textContent = d;

      const dateStr = this.dateStr(this.currentYear, this.currentMonth, d);
      const isToday = today.getFullYear() === this.currentYear &&
                      today.getMonth() === this.currentMonth &&
                      today.getDate() === d;
      const isPast = new Date(this.currentYear, this.currentMonth, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const hasSlots = this.availableSlots[dateStr] && this.availableSlots[dateStr].length > 0;
      const isSelected = this.selectedDate === dateStr;

      if (isToday) dayEl.classList.add('today');
      if (isSelected) dayEl.classList.add('selected');
      if (isPast || (!hasSlots && !this.isLoading && !this.previewMode)) {
        dayEl.classList.add('disabled');
      }

      dayEl.onclick = () => {
        if (dayEl.classList.contains('disabled')) return;
        this.selectedDate = dateStr;
        this.selectedSlot = null;
        this.goToStep(this.steps.indexOf('time'));
      };

      days.appendChild(dayEl);
    }

    container.appendChild(days);
  }

  // ── Combined Calendar + Time ───────────────────────────────────────────

  renderCalendarAndTime(container) {
    const wrapper = el('div', 'ct-combined');

    const calSide = el('div', 'ct-combined-cal');
    this.renderCalendar(calSide);
    wrapper.appendChild(calSide);

    const timeSide = el('div', 'ct-combined-time');
    this.renderTimeSlotsInline(timeSide);
    wrapper.appendChild(timeSide);

    container.appendChild(wrapper);

    // Store refs so date clicks can update only the time column, not the whole app
    this.els.combinedCal = calSide;
    this.els.combinedTime = timeSide;

    // Surgical day click — update selection + re-render time panel only
    calSide.querySelectorAll('.ct-cal-day').forEach((dayBtn, idx) => {
      dayBtn.onclick = () => {
        if (dayBtn.classList.contains('disabled') || dayBtn.classList.contains('empty')) return;
        const d = parseInt(dayBtn.textContent);
        if (isNaN(d)) return;

        this.selectedDate = this.dateStr(this.currentYear, this.currentMonth, d);
        this.selectedSlot = null;

        // Update selected highlight without rebuilding DOM
        calSide.querySelectorAll('.ct-cal-day.selected').forEach(e => e.classList.remove('selected'));
        dayBtn.classList.add('selected');

        // Replace the time panel contents only
        const newTime = el('div', 'ct-combined-time');
        this.renderTimeSlotsInline(newTime);
        this.els.combinedTime.replaceWith(newTime);
        this.els.combinedTime = newTime;
      };
    });
  }

  renderTimeSlotsInline(container) {
    const dateStr = this.selectedDate || this.getPreviewDate();
    const slots = this.availableSlots[dateStr] || [];

    const dateLabel = el('div', 'ct-slots-date');
    dateLabel.textContent = this.selectedDate ? this.formatDate(dateStr) : 'Select a date';
    container.appendChild(dateLabel);

    if (slots.length === 0) {
      const empty = el('div', 'ct-slots-empty');
      empty.textContent = this.selectedDate ? 'No available times' : 'Pick a date to see times';
      container.appendChild(empty);
      return;
    }

    const style = (this.config.timeSlots && this.config.timeSlots.style) || 'pills';
    const grid = el('div', `ct-slots-grid style-${style}`);

    slots.forEach(slot => {
      const slotEl = el('button', 'ct-slot');
      slotEl.textContent = this.formatTime(slot);
      if (this.selectedSlot === slot) slotEl.classList.add('selected');
      slotEl.onclick = () => {
        this.selectedSlot = slot;
        this.goToStep(this.steps.indexOf('form'));
      };
      grid.appendChild(slotEl);
    });

    container.appendChild(grid);
  }

  // ── Time Slots ──────────────────────────────────────────────────────────

  renderTimeSlots(container) {
    if (!this.selectedDate && !this.previewMode) {
      const empty = el('div', 'ct-slots-empty');
      empty.textContent = 'Select a date first';
      container.appendChild(empty);
      this.addBackButton(container, 'calendar');
      return;
    }

    const dateStr = this.selectedDate || this.getPreviewDate();
    const slots = this.availableSlots[dateStr] || [];

    // Date label
    const dateLabel = el('div', 'ct-slots-date');
    dateLabel.textContent = this.formatDate(dateStr);
    container.appendChild(dateLabel);

    if (slots.length === 0) {
      const empty = el('div', 'ct-slots-empty');
      empty.textContent = 'No available times for this date';
      container.appendChild(empty);
      this.addBackButton(container, 'calendar');
      return;
    }

    const style = (this.config.timeSlots && this.config.timeSlots.style) || 'pills';
    const grid = el('div', `ct-slots-grid style-${style}`);

    slots.forEach(slot => {
      const slotEl = el('button', 'ct-slot');
      slotEl.textContent = this.formatTime(slot);
      if (this.selectedSlot === slot) slotEl.classList.add('selected');
      slotEl.onclick = () => {
        this.selectedSlot = slot;
        this.goToStep(this.steps.indexOf('form'));
      };
      grid.appendChild(slotEl);
    });

    container.appendChild(grid);
    this.addBackButton(container, 'calendar');
  }

  // ── Booking Form ────────────────────────────────────────────────────────

  renderForm(container) {
    const fields = (this.config.form && this.config.form.fields) || [
      { name: 'name', label: 'Full Name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
    ];

    // Summary
    if (this.selectedDate && this.selectedSlot) {
      const summary = el('div', 'ct-form-summary');
      summary.innerHTML = `<strong>${this.formatDate(this.selectedDate)}</strong> at <strong>${this.formatTime(this.selectedSlot)}</strong>`;
      container.appendChild(summary);
    }

    const form = el('form', 'ct-form');
    form.onsubmit = (e) => { e.preventDefault(); this.handleSubmit(form); };

    fields.forEach(field => {
      const fieldWrap = el('div', 'ct-field');
      const label = el('label', '');
      label.textContent = field.label || field.name;
      if (field.required) {
        const req = el('span', 'required');
        req.textContent = '*';
        label.appendChild(req);
      }
      fieldWrap.appendChild(label);

      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
      } else if (field.type === 'select' && field.options) {
        input = document.createElement('select');
        field.options.forEach(opt => {
          const option = document.createElement('option');
          option.value = opt.value || opt;
          option.textContent = opt.label || opt;
          input.appendChild(option);
        });
      } else {
        input = document.createElement('input');
        input.type = field.type || 'text';
      }

      input.name = field.name;
      input.placeholder = field.placeholder || '';
      if (field.required) input.required = true;
      fieldWrap.appendChild(input);

      const errMsg = el('div', 'ct-field-error');
      errMsg.textContent = `${field.label || field.name} is required`;
      fieldWrap.appendChild(errMsg);

      form.appendChild(fieldWrap);
    });

    const comp = this.config.components || {};
    const submitBtn = el('button', 'ct-btn ct-btn-primary');
    submitBtn.type = 'submit';
    submitBtn.textContent = comp.confirmButtonText || 'Confirm Booking';
    this.els.submitBtn = submitBtn;
    form.appendChild(submitBtn);

    container.appendChild(form);
    // Back goes to time step, or combined step if using calendar+time
    const backTarget = this.steps.includes('calendar+time') ? 'calendar+time' : 'time';
    this.addBackButton(container, backTarget);
  }

  async handleSubmit(form) {
    // Validate
    const fields = form.querySelectorAll('input, textarea, select');
    let valid = true;
    fields.forEach(f => {
      const wrap = f.closest('.ct-field');
      if (f.required && !f.value.trim()) {
        wrap.classList.add('has-error');
        valid = false;
      } else {
        wrap.classList.remove('has-error');
      }
    });

    if (!valid) return;

    // Collect form data
    const data = {};
    fields.forEach(f => { data[f.name] = f.value.trim(); });
    data.startTime = this.selectedSlot;
    data.timezone = this.timezone;

    // Calculate endTime (assume 30 min slot if not specified)
    if (data.startTime) {
      const start = new Date(data.startTime);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      data.endTime = end.toISOString();
    }

    // Disable button
    if (this.els.submitBtn) {
      this.els.submitBtn.disabled = true;
      this.els.submitBtn.textContent = 'Booking...';
    }

    if (this.previewMode) {
      // In preview, just simulate success
      setTimeout(() => {
        this.bookingResult = { ok: true };
        this.goToStep(this.steps.indexOf('confirm'));
      }, 800);
      return;
    }

    try {
      const result = this.onBook ? await this.onBook(data) : { ok: true };
      this.bookingResult = result;
      this.goToStep(this.steps.indexOf('confirm'));
    } catch (err) {
      this.bookingResult = { ok: false, error: err.message || 'Booking failed' };
      this.goToStep(this.steps.indexOf('confirm'));
    }
  }

  // ── Confirmation ────────────────────────────────────────────────────────

  renderConfirmation(container) {
    const comp = this.config.components || {};
    const result = this.bookingResult;
    const isError = result && !result.ok;

    const confirm = el('div', `ct-confirm ${isError ? 'ct-confirm-error' : ''}`);

    const icon = el('div', 'ct-confirm-icon');
    icon.textContent = isError ? '!' : '\u2713';
    confirm.appendChild(icon);

    const title = el('div', 'ct-confirm-title');
    title.textContent = isError ? 'Booking Failed' : 'Booking Confirmed';
    confirm.appendChild(title);

    const msg = el('div', 'ct-confirm-msg');
    if (isError) {
      msg.textContent = (result && result.error) || 'Something went wrong. Please try again.';
    } else {
      msg.textContent = comp.successMessage || "You're all set! Check your email for confirmation.";
    }
    confirm.appendChild(msg);

    if (isError) {
      const retryBtn = el('button', 'ct-btn ct-btn-primary');
      retryBtn.textContent = 'Try Again';
      retryBtn.style.marginTop = '16px';
      retryBtn.onclick = () => this.goToStep(this.steps.indexOf('form'));
      confirm.appendChild(retryBtn);
    }

    container.appendChild(confirm);
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  goToStep(stepIndex) {
    if (stepIndex < 0) stepIndex = 0;
    if (stepIndex >= this.steps.length) stepIndex = this.steps.length - 1;
    this.currentStep = stepIndex;
    this.render();
    if (!this.previewMode && this.steps[stepIndex] === 'calendar') {
      this.fetchSlotsForMonth(this.currentYear, this.currentMonth);
    }
  }

  navigateMonth(delta) {
    this.currentMonth += delta;
    if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
    if (this.currentMonth < 0)  { this.currentMonth = 11; this.currentYear--; }
    this.render();
    if (!this.previewMode) {
      this.fetchSlotsForMonth(this.currentYear, this.currentMonth);
    } else {
      this.loadMockSlots();
    }
  }

  addBackButton(container, targetStep) {
    const layout = (this.config.layout && this.config.layout.type) || 'multi-step';
    if (layout !== 'multi-step') return;

    const nav = el('div', 'ct-nav-buttons');
    const backBtn = el('button', 'ct-btn ct-btn-secondary');
    backBtn.textContent = '\u2190 Back';
    backBtn.onclick = () => this.goToStep(this.steps.indexOf(targetStep));
    nav.appendChild(backBtn);
    container.appendChild(nav);
  }

  // ── Slot Fetching ───────────────────────────────────────────────────────

  async fetchSlotsForMonth(year, month) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Check cache (5 min TTL)
    const cached = this.slotCache.get(key);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      this.availableSlots = { ...this.availableSlots, ...cached.data };
      this.isLoading = false;
      this.initialLoaded = true;
      this.render();
      return;
    }

    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    this.isLoading = true;
    // Only show a loading state on the very first fetch; subsequent fetches
    // keep the existing calendar visible to avoid jarring flicker.
    if (!this.initialLoaded) this.renderLoadingState();

    try {
      const data = this.onFetchSlots
        ? await this.onFetchSlots(startDate, endDate, this.timezone)
        : {};

      // Server returns { slots: { 'YYYY-MM-DD': ['iso1','iso2',...] } }
      const normalized = {};
      const slotsObj = data.slots || data;
      if (slotsObj && typeof slotsObj === 'object') {
        for (const [dateKey, val] of Object.entries(slotsObj)) {
          if (!/^\d{4}-\d{2}-\d{2}/.test(dateKey)) continue;
          if (Array.isArray(val)) {
            normalized[dateKey] = val;
          } else if (val && Array.isArray(val.slots)) {
            normalized[dateKey] = val.slots;
          }
        }
      }

      this.slotCache.set(key, { data: normalized, ts: Date.now() });
      this.availableSlots = { ...this.availableSlots, ...normalized };
    } catch (err) {
      console.error('[CalRenderer] Slot fetch error:', err);
    }

    this.isLoading = false;
    this.initialLoaded = true;
    this.render();
  }

  // ── Mock Data (Preview Mode) ────────────────────────────────────────────

  loadMockSlots() {
    const slots = {};
    const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
    const today = new Date();

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(this.currentYear, this.currentMonth, d);
      // Skip weekends and past dates in mock
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      if (date < new Date(today.getFullYear(), today.getMonth(), today.getDate())) continue;

      const dateStr = this.dateStr(this.currentYear, this.currentMonth, d);
      const times = [];
      for (let h = 9; h <= 16; h++) {
        times.push(new Date(this.currentYear, this.currentMonth, d, h, 0).toISOString());
        if (h < 16) times.push(new Date(this.currentYear, this.currentMonth, d, h, 30).toISOString());
      }
      slots[dateStr] = times;
    }

    this.availableSlots = slots;
    if (!this.selectedDate) {
      // Auto-select first available
      const first = Object.keys(slots)[0];
      if (first) this.selectedDate = first;
    }
    this.render();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  getPreviewDate() {
    const today = new Date();
    return this.dateStr(today.getFullYear(), today.getMonth(), today.getDate());
  }

  dateStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  formatMonthYear(y, m) {
    return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  formatTime(isoOrTime) {
    try {
      const d = new Date(isoOrTime);
      if (isNaN(d.getTime())) return isoOrTime;
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: this.timezone });
    } catch {
      return isoOrTime;
    }
  }

  // ── Timezone UI ──────────────────────────────────────────────────────────

  buildTimezoneSelector() {
    const wrap = el('div', 'ct-timezone');

    const labelWrap = el('div', 'ct-timezone-meta');
    const labelIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    labelIcon.setAttribute('viewBox', '0 0 16 16');
    labelIcon.setAttribute('fill', 'none');
    labelIcon.setAttribute('class', 'ct-timezone-icon');
    labelIcon.innerHTML = '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M2 8h12M8 2a9 9 0 010 12M8 2a9 9 0 000 12" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>';
    labelWrap.appendChild(labelIcon);

    const labelText = el('span', 'ct-timezone-label');
    labelText.textContent = 'Times shown in';
    labelWrap.appendChild(labelText);

    const selectWrap = el('div', 'ct-timezone-select-wrap');
    const select = el('select', 'ct-timezone-select');
    select.setAttribute('aria-label', 'Select timezone');

    const zones = this.timezoneOptionList();
    const detected = this.detectedTimezone;
    const current = this.timezone;
    const exists = zones.some(z => z.tz === current);

    // Auto option
    const autoOpt = document.createElement('option');
    autoOpt.value = '__auto__';
    autoOpt.textContent = `Auto — ${this.timezoneCityLabel(detected)}`;
    if (this.tzIsAuto) autoOpt.selected = true;
    select.appendChild(autoOpt);

    // Group by region
    const groups = {};
    zones.forEach(z => {
      const region = z.tz.split('/')[0];
      if (!groups[region]) groups[region] = [];
      groups[region].push(z);
    });

    Object.keys(groups).sort().forEach(region => {
      const og = document.createElement('optgroup');
      og.label = region.replace(/_/g, ' ');
      groups[region].forEach(z => {
        const opt = document.createElement('option');
        opt.value = z.tz;
        opt.textContent = z.label;
        if (!this.tzIsAuto && z.tz === current) opt.selected = true;
        og.appendChild(opt);
      });
      select.appendChild(og);
    });

    // If the current tz isn't in the curated list, add it so it shows selected
    if (!exists && !this.tzIsAuto) {
      const og = document.createElement('optgroup');
      og.label = 'Current';
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = this.timezoneCityLabel(current);
      opt.selected = true;
      og.appendChild(opt);
      select.appendChild(og);
    }

    select.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === '__auto__') {
        this.setTimezone(this.detectedTimezone, { auto: true });
      } else {
        this.setTimezone(val, { auto: false });
      }
    });

    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 12 12');
    chev.setAttribute('fill', 'none');
    chev.setAttribute('class', 'ct-timezone-chev');
    chev.innerHTML = '<path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';

    selectWrap.appendChild(select);
    selectWrap.appendChild(chev);

    wrap.appendChild(labelWrap);
    wrap.appendChild(selectWrap);
    return wrap;
  }

  timezoneCityLabel(tz) {
    if (!tz) return '';
    const city = tz.split('/').pop().replace(/_/g, ' ');
    const offset = this.timezoneOffsetLabel(tz);
    return offset ? `${city} (${offset})` : city;
  }

  timezoneOffsetLabel(tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
      const p = parts.find(x => x.type === 'timeZoneName');
      if (!p) return '';
      return p.value.replace('GMT', 'UTC');
    } catch { return ''; }
  }

  timezoneOptionList() {
    const zones = [
      'Pacific/Honolulu','America/Anchorage','America/Los_Angeles','America/Vancouver',
      'America/Phoenix','America/Denver','America/Edmonton','America/Chicago','America/Mexico_City',
      'America/New_York','America/Toronto','America/Halifax','America/St_Johns',
      'America/Sao_Paulo','America/Argentina/Buenos_Aires','America/Santiago','America/Bogota','America/Lima',
      'Atlantic/Azores','Atlantic/Reykjavik',
      'Europe/London','Europe/Dublin','Europe/Lisbon',
      'Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Rome','Europe/Amsterdam','Europe/Brussels',
      'Europe/Stockholm','Europe/Copenhagen','Europe/Warsaw','Europe/Prague','Europe/Zurich','Europe/Vienna',
      'Europe/Athens','Europe/Helsinki','Europe/Bucharest','Europe/Istanbul','Europe/Moscow',
      'Africa/Casablanca','Africa/Lagos','Africa/Cairo','Africa/Nairobi','Africa/Johannesburg',
      'Asia/Jerusalem','Asia/Riyadh','Asia/Dubai','Asia/Tehran','Asia/Karachi','Asia/Kolkata','Asia/Kathmandu',
      'Asia/Dhaka','Asia/Bangkok','Asia/Jakarta','Asia/Singapore','Asia/Manila','Asia/Hong_Kong',
      'Asia/Shanghai','Asia/Taipei','Asia/Seoul','Asia/Tokyo',
      'Australia/Perth','Australia/Adelaide','Australia/Brisbane','Australia/Sydney','Australia/Melbourne',
      'Pacific/Auckland','Pacific/Fiji',
    ];
    return zones.map(tz => ({ tz, label: this.timezoneCityLabel(tz) }));
  }
}

// ── DOM helper ───────────────────────────────────────────────────────────
function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
