/**
 * CalTheme Builder App
 *
 * Manages multi-theme CRUD, rich config editor, live preview via CalendarRenderer,
 * and calendar-to-theme assignment.
 */

(function () {
  'use strict';

  const params   = new URLSearchParams(location.search);
  const LOC_ID   = params.get('locationId') || '';
  const BASE_URL = location.origin;

  // ── State ────────────────────────────────────────────────────────────────

  let themes = [];
  let currentThemeId = null;
  let currentConfig = null;
  let calendars = [];
  let assignments = [];
  let previewRenderer = null;
  let presets = [];
  let activeEditorTab = 'colors';
  let activePreviewTab = 'preview';

  // ── DOM Refs ─────────────────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    $('#loc-display').textContent = LOC_ID || 'no location';

    if (!LOC_ID) {
      $('#loading').classList.add('hidden');
      return;
    }

    try {
      const [themesRes, calRes, assignRes, presetsRes] = await Promise.all([
        fetch(`${BASE_URL}/api/themes/${LOC_ID}`),
        fetch(`${BASE_URL}/api/calendars/${LOC_ID}`),
        fetch(`${BASE_URL}/api/assignments/${LOC_ID}`),
        fetch(`${BASE_URL}/api/presets`),
      ]);

      if (themesRes.ok) {
        const data = await themesRes.json();
        themes = data.themes || [];
      }

      if (calRes.ok) {
        const data = await calRes.json();
        calendars = data.calendars || [];
      }

      if (assignRes.ok) {
        const data = await assignRes.json();
        assignments = data.assignments || [];
      }

      if (presetsRes.ok) {
        const data = await presetsRes.json();
        presets = data.presets || [];
      }
    } catch (e) {
      console.warn('Boot fetch error:', e);
    }

    renderThemeList();

    // Select first theme or show empty state
    if (themes.length > 0) {
      selectTheme(themes[0].id);
    } else {
      renderEditorEmpty();
    }

    $('#loading').classList.add('hidden');
  }

  // ── Theme List ───────────────────────────────────────────────────────────

  function renderThemeList() {
    const container = $('#theme-list-items');
    container.innerHTML = '';

    themes.forEach(t => {
      const config = typeof t.config === 'string' ? JSON.parse(t.config) : (t.config || {});
      const colors = config.colors || {};
      const assignCount = assignments.filter(a => a.theme_id === t.id).length;

      const card = document.createElement('div');
      card.className = `theme-card ${t.id === currentThemeId ? 'active' : ''}`;
      card.onclick = () => selectTheme(t.id);

      card.innerHTML = `
        <div class="theme-card-name">${escHtml(t.name || 'Untitled')}</div>
        <div class="theme-card-swatches">
          <div class="theme-card-swatch" style="background:${colors.primary || '#6C63FF'}"></div>
          <div class="theme-card-swatch" style="background:${colors.background || '#FFFFFF'}"></div>
          <div class="theme-card-swatch" style="background:${colors.buttonBg || colors.primary || '#6C63FF'}"></div>
        </div>
        <div class="theme-card-meta">${assignCount} calendar${assignCount !== 1 ? 's' : ''}</div>
        <div class="theme-card-actions">
          <button class="theme-card-action" title="Duplicate" onclick="event.stopPropagation(); window._builder.duplicateTheme('${t.id}')">⧉</button>
          <button class="theme-card-action danger" title="Delete" onclick="event.stopPropagation(); window._builder.deleteTheme('${t.id}')">×</button>
        </div>
      `;

      container.appendChild(card);
    });
  }

  function selectTheme(themeId) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) return;

    currentThemeId = themeId;
    currentConfig = typeof theme.config === 'string' ? JSON.parse(theme.config) : { ...(theme.config || {}) };

    renderThemeList();
    renderEditor();
    renderPreview();
  }

  function showPresetPicker() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.25);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:560px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.15);';

    let html = '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">Choose a starter theme</div>';
    html += '<div style="font-size:12px;color:var(--muted);margin-bottom:16px;">Pick a preset or start from scratch.</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">';

    // Blank option
    html += `
      <div class="option-card" style="padding:14px 10px;cursor:pointer" data-preset-id="blank">
        <div style="display:flex;gap:3px;margin-bottom:6px;justify-content:center">
          <div style="width:16px;height:16px;border-radius:3px;border:1px dashed var(--border)"></div>
        </div>
        <div style="font-size:11px;font-weight:500">Blank</div>
        <div style="font-size:10px;color:var(--muted)">Start from scratch</div>
      </div>
    `;

    presets.forEach(p => {
      const pc = p.previewColors || {};
      html += `
        <div class="option-card" style="padding:14px 10px;cursor:pointer" data-preset-id="${p.id}">
          <div style="display:flex;gap:3px;margin-bottom:6px;justify-content:center">
            <div style="width:16px;height:16px;border-radius:3px;background:${pc.primary || '#6C63FF'}"></div>
            <div style="width:16px;height:16px;border-radius:3px;background:${pc.background || '#FFF'};border:1px solid var(--border)"></div>
            <div style="width:16px;height:16px;border-radius:3px;background:${pc.accent || pc.primary || '#6C63FF'}"></div>
          </div>
          <div style="font-size:11px;font-weight:500">${escHtml(p.name)}</div>
          <div style="font-size:10px;color:var(--muted)">${escHtml(p.description || '')}</div>
        </div>
      `;
    });

    html += '</div>';
    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Handle selection
    modal.querySelectorAll('[data-preset-id]').forEach(card => {
      card.addEventListener('click', () => {
        const presetId = card.dataset.presetId;
        let config = null;
        let name = 'New Theme';

        if (presetId !== 'blank') {
          const preset = presets.find(p => p.id === presetId);
          if (preset) {
            config = preset.config;
            name = preset.name;
          }
        }

        overlay.remove();
        doCreateTheme(name, config);
      });
    });
  }

  async function doCreateTheme(name, presetConfig) {
    try {
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'New Theme', config: presetConfig || {} }),
      });
      if (!res.ok) throw new Error(await res.text());
      const theme = await res.json();
      themes.push(theme);
      selectTheme(theme.id);
      renderThemeList();
      showToast('Theme created', 'ok');
    } catch (e) {
      showToast('Failed to create theme: ' + e.message, 'err');
    }
  }

  function createTheme() {
    if (presets.length > 0) {
      showPresetPicker();
    } else {
      doCreateTheme('New Theme', null);
    }
  }

  async function duplicateTheme(themeId) {
    try {
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}/${themeId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const theme = await res.json();
      themes.push(theme);
      selectTheme(theme.id);
      renderThemeList();
      showToast('Theme duplicated', 'ok');
    } catch (e) {
      showToast('Failed to duplicate: ' + e.message, 'err');
    }
  }

  async function deleteTheme(themeId) {
    if (!confirm('Delete this theme? This cannot be undone.')) return;
    try {
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}/${themeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      themes = themes.filter(t => t.id !== themeId);
      assignments = assignments.filter(a => a.theme_id !== themeId);
      if (currentThemeId === themeId) {
        currentThemeId = themes.length > 0 ? themes[0].id : null;
        if (currentThemeId) selectTheme(currentThemeId);
        else renderEditorEmpty();
      }
      renderThemeList();
      showToast('Theme deleted', 'ok');
    } catch (e) {
      showToast('Failed to delete: ' + e.message, 'err');
    }
  }

  // ── Editor ───────────────────────────────────────────────────────────────

  function renderEditorEmpty() {
    $('#editor-body').innerHTML = `
      <div style="text-align:center;padding:40px 16px;color:var(--muted)">
        <div style="font-size:24px;margin-bottom:12px">🎨</div>
        <div style="font-size:13px;margin-bottom:16px">No themes yet</div>
        <button class="new-theme-btn" style="width:auto;margin:0 auto" onclick="window._builder.createTheme()">+ Create your first theme</button>
      </div>
    `;
    previewRenderer = null;
  }

  function renderEditor() {
    if (!currentConfig) return;

    renderEditorTabs();
    renderEditorPanel();
  }

  function renderEditorTabs() {
    const tabs = ['colors', 'typography', 'layout', 'time-slots', 'form', 'components', 'animations', 'custom-css'];
    const labels = ['Colors', 'Type', 'Layout', 'Slots', 'Form', 'UI', 'Anim', 'CSS'];

    const container = $('#editor-tabs');
    container.innerHTML = '';

    tabs.forEach((tab, i) => {
      const btn = document.createElement('button');
      btn.className = `editor-tab ${tab === activeEditorTab ? 'active' : ''}`;
      btn.textContent = labels[i];
      btn.onclick = () => { activeEditorTab = tab; renderEditor(); };
      container.appendChild(btn);
    });
  }

  function renderEditorPanel() {
    const body = $('#editor-body');
    body.innerHTML = '';

    switch (activeEditorTab) {
      case 'colors':      renderColorsPanel(body); break;
      case 'typography':  renderTypographyPanel(body); break;
      case 'layout':      renderLayoutPanel(body); break;
      case 'time-slots':  renderTimeSlotsPanel(body); break;
      case 'form':        renderFormPanel(body); break;
      case 'components':  renderComponentsPanel(body); break;
      case 'animations':  renderAnimationsPanel(body); break;
      case 'custom-css':  renderCustomCssPanel(body); break;
    }
  }

  // Colors panel
  function renderColorsPanel(body) {
    const c = currentConfig.colors || {};
    const colorFields = [
      ['primary', 'Primary', c.primary],
      ['background', 'Background', c.background],
      ['text', 'Text', c.text],
      ['textMuted', 'Text muted', c.textMuted],
      ['buttonBg', 'Button', c.buttonBg],
      ['buttonText', 'Button text', c.buttonText],
      ['accent', 'Accent', c.accent],
      ['border', 'Border', c.border],
      ['hoverBg', 'Hover', c.hoverBg],
      ['selectedBg', 'Selected', c.selectedBg],
      ['selectedText', 'Selected text', c.selectedText],
      ['todayRing', 'Today ring', c.todayRing],
      ['error', 'Error', c.error],
      ['success', 'Success', c.success],
    ];

    const section = document.createElement('div');
    section.className = 'section';
    section.innerHTML = '<div class="section-label">Colors</div>';

    colorFields.forEach(([key, label, value]) => {
      const val = value || '#000000';
      const field = document.createElement('div');
      field.className = 'color-field';
      field.innerHTML = `
        <span class="color-label">${label}</span>
        <div class="color-row">
          <div class="color-swatch" style="background:${val}">
            <input type="color" value="${val}" data-color-key="${key}">
          </div>
          <input class="color-hex" value="${val}" maxlength="9" data-hex-key="${key}" placeholder="${val}">
        </div>
      `;
      section.appendChild(field);
    });

    body.appendChild(section);

    // Wire up color events
    body.querySelectorAll('[data-color-key]').forEach(input => {
      input.addEventListener('input', (e) => {
        const key = e.target.dataset.colorKey;
        updateColor(key, e.target.value);
      });
    });

    body.querySelectorAll('[data-hex-key]').forEach(input => {
      input.addEventListener('input', (e) => {
        const key = e.target.dataset.hexKey;
        const val = e.target.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
          updateColor(key, val);
        }
      });
    });
  }

  function updateColor(key, value) {
    if (!currentConfig.colors) currentConfig.colors = {};
    currentConfig.colors[key] = value;

    // Sync swatch + hex
    const swatch = $(`[data-color-key="${key}"]`);
    const hex = $(`[data-hex-key="${key}"]`);
    if (swatch) { swatch.value = value; swatch.parentElement.style.background = value; }
    if (hex) hex.value = value;

    updatePreview();
  }

  // Typography panel
  function renderTypographyPanel(body) {
    const t = currentConfig.typography || {};
    body.innerHTML = `
      <div class="section">
        <div class="section-label">Typography</div>
        <div class="field">
          <label>Font family</label>
          <div class="select-wrap">
            <select id="ed-fontFamily">
              <option value="'DM Sans', sans-serif" ${t.fontFamily?.includes('DM Sans') ? 'selected' : ''}>DM Sans</option>
              <option value="'Inter', sans-serif" ${t.fontFamily?.includes('Inter') ? 'selected' : ''}>Inter</option>
              <option value="'Poppins', sans-serif" ${t.fontFamily?.includes('Poppins') ? 'selected' : ''}>Poppins</option>
              <option value="'Georgia', serif" ${t.fontFamily?.includes('Georgia') ? 'selected' : ''}>Georgia</option>
              <option value="'Helvetica Neue', sans-serif" ${t.fontFamily?.includes('Helvetica') ? 'selected' : ''}>Helvetica Neue</option>
              <option value="system-ui, sans-serif" ${t.fontFamily?.includes('system-ui') ? 'selected' : ''}>System UI</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Heading size</label>
          <div class="slider-row">
            <input type="range" id="ed-headingSize" min="14" max="28" value="${parseInt(t.headingSize) || 18}">
            <span class="slider-val">${parseInt(t.headingSize) || 18}px</span>
          </div>
        </div>
        <div class="field">
          <label>Body size</label>
          <div class="slider-row">
            <input type="range" id="ed-bodySize" min="11" max="18" value="${parseInt(t.bodySize) || 14}">
            <span class="slider-val">${parseInt(t.bodySize) || 14}px</span>
          </div>
        </div>
        <div class="field">
          <label>Font weight</label>
          <div class="select-wrap">
            <select id="ed-fontWeight">
              <option value="400" ${t.fontWeight === '400' ? 'selected' : ''}>Regular (400)</option>
              <option value="500" ${t.fontWeight === '500' || !t.fontWeight ? 'selected' : ''}>Medium (500)</option>
              <option value="600" ${t.fontWeight === '600' ? 'selected' : ''}>Semibold (600)</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Heading weight</label>
          <div class="select-wrap">
            <select id="ed-headingWeight">
              <option value="500" ${t.headingWeight === '500' ? 'selected' : ''}>Medium (500)</option>
              <option value="600" ${t.headingWeight === '600' || !t.headingWeight ? 'selected' : ''}>Semibold (600)</option>
              <option value="700" ${t.headingWeight === '700' ? 'selected' : ''}>Bold (700)</option>
            </select>
          </div>
        </div>
      </div>
    `;

    wireUpTypography(body);
  }

  function wireUpTypography(body) {
    const onChange = () => {
      if (!currentConfig.typography) currentConfig.typography = {};
      currentConfig.typography.fontFamily = body.querySelector('#ed-fontFamily').value;
      currentConfig.typography.headingSize = body.querySelector('#ed-headingSize').value + 'px';
      currentConfig.typography.bodySize = body.querySelector('#ed-bodySize').value + 'px';
      currentConfig.typography.fontWeight = body.querySelector('#ed-fontWeight').value;
      currentConfig.typography.headingWeight = body.querySelector('#ed-headingWeight').value;
      updatePreview();
    };

    body.querySelectorAll('select, input[type="range"]').forEach(el => {
      el.addEventListener('input', (e) => {
        const slider = e.target.closest('.slider-row');
        if (slider) slider.querySelector('.slider-val').textContent = e.target.value + 'px';
        onChange();
      });
    });
  }

  // Layout panel
  function renderLayoutPanel(body) {
    const l = currentConfig.layout || {};
    const stepsOrder = l.stepsOrder || ['calendar', 'time', 'form', 'confirm'];

    // Step flow presets
    const flowPresets = [
      { id: 'date-time-form',   label: 'Date > Time > Form',     steps: ['calendar', 'time', 'form', 'confirm'] },
      { id: 'time-date-form',   label: 'Time > Date > Form',     steps: ['time', 'calendar', 'form', 'confirm'] },
      { id: 'date-time-inline', label: 'Date + Time > Form',     steps: ['calendar+time', 'form', 'confirm'] },
    ];

    const currentFlowId = getFlowPresetId(stepsOrder, flowPresets);

    let flowHtml = '';
    flowPresets.forEach(fp => {
      flowHtml += `
        <div class="option-card ${fp.id === currentFlowId ? 'active' : ''}" data-flow="${fp.id}">
          <div style="font-size:11px;font-weight:500">${fp.label}</div>
        </div>
      `;
    });

    // Custom drag-sortable step list
    let stepListHtml = '';
    stepsOrder.forEach((step, i) => {
      const label = stepLabel(step);
      stepListHtml += `
        <div class="step-order-item" data-step="${step}">
          <span class="step-order-handle">&#9776;</span>
          <span class="step-order-label">${label}</span>
          <div class="step-order-arrows">
            <button class="theme-card-action" title="Move up" data-move-step="${i}" data-dir="-1">&#8593;</button>
            <button class="theme-card-action" title="Move down" data-move-step="${i}" data-dir="1">&#8595;</button>
          </div>
        </div>
      `;
    });

    body.innerHTML = `
      <div class="section">
        <div class="section-label">Layout type</div>
        <div class="option-cards">
          <div class="option-card ${l.type === 'multi-step' ? 'active' : ''}" data-layout="multi-step">
            <div class="option-card-icon">&#128209;</div>
            Multi-step
          </div>
          <div class="option-card ${l.type === 'single-page' ? 'active' : ''}" data-layout="single-page">
            <div class="option-card-icon">&#128195;</div>
            Single page
          </div>
          <div class="option-card ${l.type === 'sidebar' ? 'active' : ''}" data-layout="sidebar">
            <div class="option-card-icon">&#128208;</div>
            Sidebar
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-label">Booking flow</div>
        <div class="option-cards flow-cards">${flowHtml}</div>
        <div class="step-order-list" style="margin-top:10px">${stepListHtml}</div>
      </div>
      <div class="section">
        <div class="section-label">Spacing</div>
        <div class="field">
          <label>Border radius</label>
          <div class="slider-row">
            <input type="range" id="ed-borderRadius" min="0" max="24" value="${currentConfig.spacing?.borderRadius ?? 8}">
            <span class="slider-val">${currentConfig.spacing?.borderRadius ?? 8}px</span>
          </div>
        </div>
        <div class="field">
          <label>Padding</label>
          <div class="slider-row">
            <input type="range" id="ed-padding" min="8" max="32" value="${currentConfig.spacing?.padding ?? 16}">
            <span class="slider-val">${currentConfig.spacing?.padding ?? 16}px</span>
          </div>
        </div>
        <div class="field">
          <label>Gap</label>
          <div class="slider-row">
            <input type="range" id="ed-gap" min="4" max="16" value="${currentConfig.spacing?.gap ?? 8}">
            <span class="slider-val">${currentConfig.spacing?.gap ?? 8}px</span>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-label">Calendar</div>
        <div class="field">
          <label>First day of week</label>
          <div class="select-wrap">
            <select id="ed-firstDay">
              <option value="0" ${(currentConfig.calendar?.firstDayOfWeek || 0) === 0 ? 'selected' : ''}>Sunday</option>
              <option value="1" ${currentConfig.calendar?.firstDayOfWeek === 1 ? 'selected' : ''}>Monday</option>
            </select>
          </div>
        </div>
      </div>
    `;

    // Layout type cards
    body.querySelectorAll('[data-layout]').forEach(card => {
      card.onclick = () => {
        if (!currentConfig.layout) currentConfig.layout = {};
        currentConfig.layout.type = card.dataset.layout;
        body.querySelectorAll('[data-layout]').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        updatePreview();
      };
    });

    // Flow preset cards
    body.querySelectorAll('[data-flow]').forEach(card => {
      card.onclick = () => {
        const preset = flowPresets.find(p => p.id === card.dataset.flow);
        if (!preset) return;
        if (!currentConfig.layout) currentConfig.layout = {};
        currentConfig.layout.stepsOrder = [...preset.steps];
        renderEditor();
        updatePreview();
      };
    });

    // Step reorder buttons
    body.querySelectorAll('[data-move-step]').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.moveStep);
        const dir = parseInt(btn.dataset.dir);
        const steps = currentConfig.layout?.stepsOrder || ['calendar', 'time', 'form', 'confirm'];
        const newIdx = idx + dir;
        // Don't allow moving confirm away from last position
        if (newIdx < 0 || newIdx >= steps.length) return;
        if (steps[idx] === 'confirm' || steps[newIdx] === 'confirm') return;
        [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
        if (!currentConfig.layout) currentConfig.layout = {};
        currentConfig.layout.stepsOrder = steps;
        renderEditor();
        updatePreview();
      };
    });

    // Sliders
    body.querySelectorAll('input[type="range"]').forEach(el => {
      el.addEventListener('input', (e) => {
        e.target.closest('.slider-row').querySelector('.slider-val').textContent = e.target.value + 'px';
        if (!currentConfig.spacing) currentConfig.spacing = {};
        currentConfig.spacing.borderRadius = parseInt(body.querySelector('#ed-borderRadius').value);
        currentConfig.spacing.padding = parseInt(body.querySelector('#ed-padding').value);
        currentConfig.spacing.gap = parseInt(body.querySelector('#ed-gap').value);
        updatePreview();
      });
    });

    // First day
    body.querySelector('#ed-firstDay').addEventListener('change', (e) => {
      if (!currentConfig.calendar) currentConfig.calendar = {};
      currentConfig.calendar.firstDayOfWeek = parseInt(e.target.value);
      updatePreview();
    });
  }

  function getFlowPresetId(steps, presets) {
    const key = steps.join(',');
    for (const p of presets) {
      if (p.steps.join(',') === key) return p.id;
    }
    return null;
  }

  function stepLabel(step) {
    const labels = {
      'calendar': 'Date picker',
      'time': 'Time slots',
      'form': 'Booking form',
      'confirm': 'Confirmation',
      'calendar+time': 'Date + Time',
    };
    return labels[step] || step;
  }

  // Time Slots panel
  function renderTimeSlotsPanel(body) {
    const ts = currentConfig.timeSlots || {};
    body.innerHTML = `
      <div class="section">
        <div class="section-label">Slot style</div>
        <div class="option-cards">
          <div class="option-card ${ts.style === 'pills' || !ts.style ? 'active' : ''}" data-slot-style="pills">
            <div class="option-card-icon">💊</div>
            Pills
          </div>
          <div class="option-card ${ts.style === 'list' ? 'active' : ''}" data-slot-style="list">
            <div class="option-card-icon">📋</div>
            List
          </div>
          <div class="option-card ${ts.style === 'grid' ? 'active' : ''}" data-slot-style="grid">
            <div class="option-card-icon">🔲</div>
            Grid
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-label">Columns</div>
        <div class="slider-row">
          <input type="range" id="ed-slotCols" min="2" max="4" value="${ts.columns || 3}">
          <span class="slider-val">${ts.columns || 3}</span>
        </div>
      </div>
    `;

    body.querySelectorAll('[data-slot-style]').forEach(card => {
      card.onclick = () => {
        if (!currentConfig.timeSlots) currentConfig.timeSlots = {};
        currentConfig.timeSlots.style = card.dataset.slotStyle;
        body.querySelectorAll('[data-slot-style]').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        updatePreview();
      };
    });

    body.querySelector('#ed-slotCols').addEventListener('input', (e) => {
      e.target.closest('.slider-row').querySelector('.slider-val').textContent = e.target.value;
      if (!currentConfig.timeSlots) currentConfig.timeSlots = {};
      currentConfig.timeSlots.columns = parseInt(e.target.value);
      updatePreview();
    });
  }

  // Form panel
  function renderFormPanel(body) {
    const fields = (currentConfig.form && currentConfig.form.fields) || [];

    let html = '<div class="section"><div class="section-label">Booking form fields</div><div class="form-fields-list">';

    fields.forEach((f, i) => {
      html += `
        <div class="form-field-item">
          <div class="field-info">
            <div class="field-name">${escHtml(f.label || f.name)} ${f.required ? '<span style="color:var(--danger)">*</span>' : ''}</div>
            <div class="field-type">${f.type || 'text'}</div>
          </div>
          <div class="field-actions">
            <button class="theme-card-action" title="Move up" onclick="window._builder.moveFormField(${i}, -1)">↑</button>
            <button class="theme-card-action" title="Move down" onclick="window._builder.moveFormField(${i}, 1)">↓</button>
            <button class="theme-card-action danger" title="Remove" onclick="window._builder.removeFormField(${i})">×</button>
          </div>
        </div>
      `;
    });

    html += '</div>';
    html += '<button class="add-field-btn" style="margin-top:8px" onclick="window._builder.addFormField()">+ Add field</button>';
    html += '</div>';

    body.innerHTML = html;
  }

  function addFormField() {
    const name = prompt('Field name (e.g., "company"):');
    if (!name) return;
    const label = prompt('Label:', name.charAt(0).toUpperCase() + name.slice(1));
    const type = prompt('Type (text, email, tel, textarea, select):', 'text') || 'text';

    if (!currentConfig.form) currentConfig.form = { fields: [] };
    currentConfig.form.fields.push({ name, label: label || name, type, required: false, placeholder: '' });
    renderEditor();
    updatePreview();
  }

  function removeFormField(index) {
    if (!currentConfig.form || !currentConfig.form.fields) return;
    currentConfig.form.fields.splice(index, 1);
    renderEditor();
    updatePreview();
  }

  function moveFormField(index, direction) {
    if (!currentConfig.form || !currentConfig.form.fields) return;
    const fields = currentConfig.form.fields;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= fields.length) return;
    [fields[index], fields[newIndex]] = [fields[newIndex], fields[index]];
    renderEditor();
    updatePreview();
  }

  // Components panel
  function renderComponentsPanel(body) {
    const comp = currentConfig.components || {};

    body.innerHTML = `
      <div class="section">
        <div class="section-label">Visibility</div>
        <div class="toggle-row">
          <span class="toggle-label">Show header</span>
          <div class="toggle ${comp.showHeader !== false ? 'on' : ''}" data-toggle="showHeader"></div>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Show progress bar</span>
          <div class="toggle ${comp.showProgressBar !== false ? 'on' : ''}" data-toggle="showProgressBar"></div>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Show timezone</span>
          <div class="toggle ${comp.showTimezone !== false ? 'on' : ''}" data-toggle="showTimezone"></div>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Show "Powered by"</span>
          <div class="toggle ${comp.showPoweredBy !== false ? 'on' : ''}" data-toggle="showPoweredBy"></div>
        </div>
      </div>
      <div class="section">
        <div class="section-label">Text</div>
        <div class="field">
          <label>Header text</label>
          <input type="text" id="ed-headerText" value="${escHtml(comp.headerText || 'Book an Appointment')}">
        </div>
        <div class="field">
          <label>Confirm button text</label>
          <input type="text" id="ed-confirmBtn" value="${escHtml(comp.confirmButtonText || 'Confirm Booking')}">
        </div>
        <div class="field">
          <label>Success message</label>
          <textarea id="ed-successMsg" rows="2">${escHtml(comp.successMessage || "You're all set! Check your email for confirmation.")}</textarea>
        </div>
      </div>
    `;

    // Toggles
    body.querySelectorAll('[data-toggle]').forEach(toggle => {
      toggle.onclick = () => {
        toggle.classList.toggle('on');
        if (!currentConfig.components) currentConfig.components = {};
        currentConfig.components[toggle.dataset.toggle] = toggle.classList.contains('on');
        updatePreview();
      };
    });

    // Text inputs
    ['ed-headerText', 'ed-confirmBtn', 'ed-successMsg'].forEach(id => {
      const el = body.querySelector(`#${id}`);
      if (el) el.addEventListener('input', () => {
        if (!currentConfig.components) currentConfig.components = {};
        currentConfig.components.headerText = body.querySelector('#ed-headerText').value;
        currentConfig.components.confirmButtonText = body.querySelector('#ed-confirmBtn').value;
        currentConfig.components.successMessage = body.querySelector('#ed-successMsg').value;
        updatePreview();
      });
    });
  }

  // Animations panel
  function renderAnimationsPanel(body) {
    const a = currentConfig.animations || {};

    body.innerHTML = `
      <div class="section">
        <div class="section-label">Animations</div>
        <div class="field">
          <label>Transition speed</label>
          <div class="slider-row">
            <input type="range" id="ed-transSpeed" min="0" max="5" step="0.1" value="${parseFloat(a.transitionSpeed) || 0.2}">
            <span class="slider-val">${parseFloat(a.transitionSpeed) || 0.2}s</span>
          </div>
        </div>
        <div class="field">
          <label>Step transition</label>
          <div class="select-wrap">
            <select id="ed-stepTrans">
              <option value="slide-left" ${a.stepTransition === 'slide-left' || !a.stepTransition ? 'selected' : ''}>Slide left</option>
              <option value="fade" ${a.stepTransition === 'fade' ? 'selected' : ''}>Fade</option>
              <option value="none" ${a.stepTransition === 'none' ? 'selected' : ''}>None</option>
            </select>
          </div>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Hover scale effect</span>
          <div class="toggle ${a.hoverScale ? 'on' : ''}" data-toggle="hoverScale"></div>
        </div>
      </div>
    `;

    body.querySelector('#ed-transSpeed').addEventListener('input', (e) => {
      e.target.closest('.slider-row').querySelector('.slider-val').textContent = e.target.value + 's';
      if (!currentConfig.animations) currentConfig.animations = {};
      currentConfig.animations.transitionSpeed = e.target.value + 's';
      updatePreview();
    });

    body.querySelector('#ed-stepTrans').addEventListener('change', (e) => {
      if (!currentConfig.animations) currentConfig.animations = {};
      currentConfig.animations.stepTransition = e.target.value;
      updatePreview();
    });

    body.querySelector('[data-toggle="hoverScale"]').onclick = function() {
      this.classList.toggle('on');
      if (!currentConfig.animations) currentConfig.animations = {};
      currentConfig.animations.hoverScale = this.classList.contains('on');
      updatePreview();
    };
  }

  // Custom CSS panel
  function renderCustomCssPanel(body) {
    body.innerHTML = `
      <div class="section">
        <div class="section-label">Custom CSS</div>
        <div class="field">
          <textarea class="code-input" id="ed-customCss" rows="12" placeholder="/* Override any styles here */&#10;.ct-slot { ... }">${escHtml(currentConfig.customCss || '')}</textarea>
        </div>
      </div>
    `;

    body.querySelector('#ed-customCss').addEventListener('input', (e) => {
      currentConfig.customCss = e.target.value;
      updatePreview();
    });
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  function renderPreview() {
    renderPreviewTabs();
    const body = $('#preview-body');

    if (activePreviewTab === 'preview') {
      body.innerHTML = '<div class="preview-frame" id="preview-frame"></div>';
      const frame = $('#preview-frame');
      previewRenderer = new CalendarRenderer(frame, currentConfig, { previewMode: true });
      previewRenderer.init();
    } else if (activePreviewTab === 'assignments') {
      body.innerHTML = '<div class="assignment-panel active" id="assignment-panel"></div>';
      renderAssignments();
    }
  }

  function renderPreviewTabs() {
    const container = $('#preview-tabs');
    container.innerHTML = '';

    [['preview', 'Live Preview'], ['assignments', 'Assignments']].forEach(([key, label]) => {
      const btn = document.createElement('button');
      btn.className = `tab ${key === activePreviewTab ? 'active' : ''}`;
      btn.textContent = label;
      btn.onclick = () => { activePreviewTab = key; renderPreview(); };
      container.appendChild(btn);
    });
  }

  function updatePreview() {
    if (previewRenderer && activePreviewTab === 'preview') {
      previewRenderer.updateConfig(currentConfig);
    }
  }

  // ── Assignments ──────────────────────────────────────────────────────────

  function renderAssignments() {
    const panel = $('#assignment-panel');
    if (!panel) return;

    if (calendars.length === 0) {
      panel.innerHTML = '<div style="text-align:center;color:var(--muted);padding:24px">No calendars found for this location.</div>';
      return;
    }

    let html = '<div class="section-label" style="margin-bottom:12px">Assign themes to calendars</div>';

    calendars.forEach(cal => {
      const assignment = assignments.find(a => a.calendar_id === cal.id);
      const assignedThemeId = assignment ? assignment.theme_id : '';
      const embedUrl = assignment ? `${BASE_URL}/embed/${LOC_ID}/${cal.id}` : '';

      html += `
        <div class="assignment-row">
          <div class="assignment-cal-name">${escHtml(cal.name)}</div>
          <div class="select-wrap assignment-theme-select">
            <select data-cal-id="${cal.id}" data-cal-name="${escHtml(cal.name)}">
              <option value="">— No theme —</option>
              ${themes.map(t => `<option value="${t.id}" ${t.id === assignedThemeId ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('')}
            </select>
          </div>
          ${embedUrl ? `<div class="assignment-embed-url" title="Click to copy" onclick="window._builder.copyUrl('${embedUrl}')">${embedUrl}</div>` : ''}
        </div>
      `;
    });

    panel.innerHTML = html;

    // Wire up assignment changes
    panel.querySelectorAll('[data-cal-id]').forEach(select => {
      select.addEventListener('change', async (e) => {
        const calId = e.target.dataset.calId;
        const calName = e.target.dataset.calName;
        const themeId = e.target.value;

        if (themeId) {
          await assignTheme(themeId, calId, calName);
        } else {
          // Remove assignment
          const existing = assignments.find(a => a.calendar_id === calId);
          if (existing) await unassignTheme(existing.id);
        }

        renderAssignments();
        renderThemeList();
      });
    });
  }

  async function assignTheme(themeId, calendarId, calendarName) {
    try {
      const res = await fetch(`${BASE_URL}/api/assignments/${LOC_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId, calendarId, calendarName }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // Update local state
      assignments = assignments.filter(a => a.calendar_id !== calendarId);
      assignments.push(data);
      showToast('Theme assigned', 'ok');
    } catch (e) {
      showToast('Failed to assign: ' + e.message, 'err');
    }
  }

  async function unassignTheme(assignmentId) {
    try {
      await fetch(`${BASE_URL}/api/assignments/${LOC_ID}/${assignmentId}`, { method: 'DELETE' });
      assignments = assignments.filter(a => a.id !== assignmentId);
      showToast('Assignment removed', 'ok');
    } catch (e) {
      showToast('Failed to unassign: ' + e.message, 'err');
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function saveTheme() {
    if (!LOC_ID) { showToast('No location ID', 'err'); return; }
    if (!currentThemeId) { showToast('No theme selected', 'err'); return; }

    const btn = $('#save-btn');
    const lbl = $('#save-label');
    btn.classList.add('saving');
    lbl.textContent = 'Saving...';

    // Get current name
    const theme = themes.find(t => t.id === currentThemeId);
    const name = theme ? theme.name : 'Untitled Theme';

    try {
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}/${currentThemeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: currentConfig }),
      });

      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();

      // Update local state
      const idx = themes.findIndex(t => t.id === currentThemeId);
      if (idx >= 0) themes[idx] = updated;

      btn.classList.remove('saving');
      lbl.textContent = 'Saved!';
      showToast('Theme saved', 'ok');

      setTimeout(() => { lbl.textContent = 'Save theme'; }, 2000);
      renderThemeList();
    } catch (e) {
      btn.classList.remove('saving');
      lbl.textContent = 'Save theme';
      showToast('Save failed: ' + e.message, 'err');
    }
  }

  // ── Rename ───────────────────────────────────────────────────────────────

  function renameTheme(themeId) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) return;
    const newName = prompt('Rename theme:', theme.name);
    if (!newName || newName === theme.name) return;
    theme.name = newName;
    renderThemeList();
    // Will persist on next save
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  let toastTimer;
  function showToast(msg, type = 'ok') {
    const t = $('#toast');
    const msgEl = t.querySelector('.toast-msg');
    if (msgEl) msgEl.textContent = msg;
    else t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  function copyUrl(url) {
    navigator.clipboard.writeText(url).then(() => showToast('Copied URL', 'ok'));
  }

  // ── Expose to global for onclick handlers ────────────────────────────────

  window._builder = {
    createTheme,
    duplicateTheme,
    deleteTheme,
    renameTheme,
    saveTheme,
    addFormField,
    removeFormField,
    moveFormField,
    copyUrl,
  };

  // Wire up topbar save button
  document.addEventListener('DOMContentLoaded', () => {
    $('#save-btn').onclick = saveTheme;
    $('#new-theme-btn').onclick = () => createTheme();
  });

  // Boot
  boot();
})();
