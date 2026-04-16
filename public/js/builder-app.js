/**
 * CalTheme Builder — Gallery + Editor views
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
  let searchQuery = '';
  let previewDevice = 'desktop';

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    $('#loc-display').textContent = LOC_ID || 'no location';

    if (!LOC_ID) {
      $('#loading').classList.add('hidden');
      renderGallery();
      return;
    }

    try {
      const [themesRes, calRes, assignRes, presetsRes] = await Promise.all([
        fetch(`${BASE_URL}/api/themes/${LOC_ID}`),
        fetch(`${BASE_URL}/api/calendars/${LOC_ID}`),
        fetch(`${BASE_URL}/api/assignments/${LOC_ID}`),
        fetch(`${BASE_URL}/api/presets`),
      ]);

      if (themesRes.ok) themes = (await themesRes.json()).themes || [];
      if (calRes.ok) calendars = (await calRes.json()).calendars || [];
      if (assignRes.ok) assignments = (await assignRes.json()).assignments || [];
      if (presetsRes.ok) presets = (await presetsRes.json()).presets || [];
    } catch (e) {
      console.warn('Boot fetch error:', e);
    }

    renderGallery();
    $('#loading').classList.add('hidden');
  }

  // ── View switching ───────────────────────────────────────────────────────

  function showView(name) {
    document.querySelectorAll('.view').forEach(v => {
      if (v.dataset.view === name) v.removeAttribute('hidden');
      else v.setAttribute('hidden', '');
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openEditor(themeId) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) return;

    currentThemeId = themeId;
    currentConfig = typeof theme.config === 'string' ? JSON.parse(theme.config) : { ...(theme.config || {}) };

    $('#theme-name-input').value = theme.name || 'Untitled theme';
    showView('editor');
    renderEditor();
    renderPreview();
  }

  function backToGallery() {
    renderGallery();
    showView('gallery');
    previewRenderer = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GALLERY
  // ═══════════════════════════════════════════════════════════════════════════

  function renderGallery() {
    const grid = $('#theme-grid');
    const empty = $('#gallery-empty');
    const sub = $('#gallery-sub');

    const filtered = themes.filter(t => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (t.name || '').toLowerCase().includes(q);
    });

    grid.innerHTML = '';

    if (themes.length === 0) {
      empty.removeAttribute('hidden');
      grid.setAttribute('hidden', '');
      sub.textContent = 'Design your booking calendar to match your brand.';
      return;
    }

    empty.setAttribute('hidden', '');
    grid.removeAttribute('hidden');

    const themeWord = themes.length === 1 ? 'theme' : 'themes';
    sub.textContent = `${themes.length} ${themeWord} · ${calendars.length} calendar${calendars.length === 1 ? '' : 's'} connected`;

    // "New theme" card first
    const newCard = document.createElement('div');
    newCard.className = 'theme-card theme-card-new';
    newCard.tabIndex = 0;
    newCard.innerHTML = `
      <div class="theme-card-new-mark">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </div>
      <div class="theme-card-new-title">New theme</div>
      <div class="theme-card-new-sub">Start from scratch or a preset</div>
    `;
    newCard.onclick = () => openPresetModal();
    newCard.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPresetModal(); } };
    grid.appendChild(newCard);

    // Theme cards
    filtered.forEach(theme => {
      const cfg = typeof theme.config === 'string' ? JSON.parse(theme.config) : (theme.config || {});
      grid.appendChild(buildThemeCard(theme, cfg));
    });
  }

  function buildThemeCard(theme, cfg) {
    const colors = cfg.colors || {};
    const typo = cfg.typography || {};
    const spacing = cfg.spacing || {};
    const comp = cfg.components || {};
    const assignCount = assignments.filter(a => a.theme_id === theme.id).length;

    const card = document.createElement('div');
    card.className = 'theme-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Edit ${theme.name || 'Untitled theme'}`);

    // inline CSS vars for mini preview
    const mpStyle = [
      ['--mp-bg',       colors.background || '#FFFFFF'],
      ['--mp-text',     colors.text || '#14110E'],
      ['--mp-muted',    colors.textMuted || '#6B675E'],
      ['--mp-primary',  colors.primary || colors.buttonBg || '#3730A3'],
      ['--mp-btn-text', colors.buttonText || '#FFFFFF'],
      ['--mp-surface',  colors.hoverBg || '#F4F3F0'],
      ['--mp-line',     colors.border || '#E5E3DD'],
      ['--mp-radius',   (spacing.borderRadius ?? 8) + 'px'],
      ['--mp-font',     typo.fontFamily || "'Plus Jakarta Sans', sans-serif"],
    ].map(([k, v]) => `${k}:${v}`).join(';');

    const headerText = comp.headerText || 'Book an Appointment';

    card.innerHTML = `
      <button class="theme-card-menu" aria-label="Theme options">
        <svg viewBox="0 0 16 16" fill="none"><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>
      </button>
      <div class="menu-popover">
        <button class="menu-item" data-action="rename"><svg viewBox="0 0 16 16" fill="none"><path d="M2 12l8-8 2 2-8 8H2v-2zM10 4l2-2 2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>Rename</button>
        <button class="menu-item" data-action="duplicate"><svg viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3"/></svg>Duplicate</button>
        <button class="menu-item danger" data-action="delete"><svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5A.5.5 0 016.5 2h3a.5.5 0 01.5.5V4M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>Delete</button>
      </div>

      <div class="mini-preview" style="${mpStyle}">
        <div class="mini-preview-header">
          <div class="mini-preview-dot"></div>
          <div class="mini-preview-label">${escHtml(headerText)}</div>
        </div>
        <div class="mini-preview-progress"><div></div><div></div><div></div><div></div></div>
        <div class="mini-preview-row">
          <div class="mini-preview-date">M</div>
          <div class="mini-preview-date">T</div>
          <div class="mini-preview-date active">W</div>
          <div class="mini-preview-date">T</div>
          <div class="mini-preview-date">F</div>
        </div>
        <div class="mini-preview-row">
          <div class="mini-preview-date">14</div>
          <div class="mini-preview-date">15</div>
          <div class="mini-preview-date">16</div>
          <div class="mini-preview-date active">17</div>
          <div class="mini-preview-date">18</div>
        </div>
        <div class="mini-preview-pills">
          <div class="mini-preview-pill">9:00</div>
          <div class="mini-preview-pill selected">10:00</div>
          <div class="mini-preview-pill">11:00</div>
        </div>
        <div class="mini-preview-cta">Confirm booking</div>
      </div>

      <div class="theme-card-info">
        <div class="theme-card-row">
          <div class="theme-card-name">${escHtml(theme.name || 'Untitled theme')}</div>
          <div class="theme-card-swatches">
            <div class="theme-card-swatch" style="background:${colors.primary || '#3730A3'}"></div>
            <div class="theme-card-swatch" style="background:${colors.background || '#FFFFFF'}"></div>
            <div class="theme-card-swatch" style="background:${colors.buttonBg || colors.primary || '#3730A3'}"></div>
          </div>
        </div>
        <div class="theme-card-meta">
          <span>${formatDate(theme.updated_at)}</span>
          <span class="theme-card-meta-dot"></span>
          <span class="theme-card-meta-chip">${assignCount} ${assignCount === 1 ? 'calendar' : 'calendars'}</span>
        </div>
      </div>
    `;

    // Card click opens editor
    card.onclick = (e) => {
      if (e.target.closest('.theme-card-menu, .menu-popover')) return;
      openEditor(theme.id);
    };
    card.onkeydown = e => { if (e.key === 'Enter') openEditor(theme.id); };

    // Menu toggle
    const menuBtn = card.querySelector('.theme-card-menu');
    const popover = card.querySelector('.menu-popover');
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      // close other popovers
      document.querySelectorAll('.menu-popover.open').forEach(p => { if (p !== popover) p.classList.remove('open'); });
      popover.classList.toggle('open');
    };

    popover.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        popover.classList.remove('open');
        const action = btn.dataset.action;
        if (action === 'rename')    await renameTheme(theme.id);
        if (action === 'duplicate') await duplicateTheme(theme.id);
        if (action === 'delete')    await deleteTheme(theme.id);
      };
    });

    return card;
  }

  // Close menu popovers on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.theme-card-menu, .menu-popover')) {
      document.querySelectorAll('.menu-popover.open').forEach(p => p.classList.remove('open'));
    }
  });

  // ── Theme CRUD ───────────────────────────────────────────────────────────

  async function doCreateTheme(name, presetConfig) {
    try {
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'New theme', config: presetConfig || {} }),
      });
      if (!res.ok) throw new Error(await res.text());
      const theme = await res.json();
      themes.push(theme);
      showToast('Theme created', 'ok');
      openEditor(theme.id);
    } catch (e) {
      showToast('Failed to create theme: ' + e.message, 'err');
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
      renderGallery();
      showToast('Theme duplicated', 'ok');
    } catch (e) {
      showToast('Failed to duplicate: ' + e.message, 'err');
    }
  }

  async function deleteTheme(themeId) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) return;
    if (!confirm(`Delete "${theme.name || 'Untitled'}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}/${themeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      themes = themes.filter(t => t.id !== themeId);
      assignments = assignments.filter(a => a.theme_id !== themeId);
      renderGallery();
      showToast('Theme deleted', 'ok');
    } catch (e) {
      showToast('Failed to delete: ' + e.message, 'err');
    }
  }

  async function renameTheme(themeId) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) return;
    const newName = prompt('Rename theme', theme.name || '');
    if (!newName || !newName.trim() || newName.trim() === theme.name) return;

    try {
      const config = typeof theme.config === 'string' ? JSON.parse(theme.config) : (theme.config || {});
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}/${themeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), config }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      const idx = themes.findIndex(t => t.id === themeId);
      if (idx >= 0) themes[idx] = updated;
      renderGallery();
      showToast('Renamed', 'ok');
    } catch (e) {
      showToast('Failed to rename: ' + e.message, 'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESET MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  function openPresetModal() {
    const body = $('#preset-body');
    const grid = document.createElement('div');
    grid.className = 'preset-grid';

    // Blank option
    const blank = document.createElement('button');
    blank.className = 'preset-card';
    blank.innerHTML = `
      <div class="preset-swatches">
        <div style="background:#F4F3F0;border:1.5px dashed #C3BFB5"></div>
      </div>
      <div class="preset-name">Blank canvas</div>
      <div class="preset-desc">Start from defaults</div>
    `;
    blank.onclick = () => {
      closePresetModal();
      doCreateTheme('New theme', null);
    };
    grid.appendChild(blank);

    presets.forEach(p => {
      const pc = p.previewColors || {};
      const card = document.createElement('button');
      card.className = 'preset-card';
      card.innerHTML = `
        <div class="preset-swatches">
          <div style="background:${pc.primary || '#3730A3'}"></div>
          <div style="background:${pc.background || '#FFF'}"></div>
          <div style="background:${pc.accent || pc.primary || '#3730A3'}"></div>
        </div>
        <div class="preset-name">${escHtml(p.name)}</div>
        <div class="preset-desc">${escHtml(p.description || '')}</div>
      `;
      card.onclick = () => {
        closePresetModal();
        doCreateTheme(p.name, p.config);
      };
      grid.appendChild(card);
    });

    body.innerHTML = '';
    body.appendChild(grid);

    const modal = $('#preset-modal');
    const backdrop = $('#preset-backdrop');
    modal.removeAttribute('hidden');
    backdrop.removeAttribute('hidden');
    requestAnimationFrame(() => {
      modal.classList.add('open');
      backdrop.classList.add('open');
    });
  }

  function closePresetModal() {
    const modal = $('#preset-modal');
    const backdrop = $('#preset-backdrop');
    modal.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      modal.setAttribute('hidden', '');
      backdrop.setAttribute('hidden', '');
    }, 300);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSIGNMENTS DRAWER
  // ═══════════════════════════════════════════════════════════════════════════

  function openAssignmentsDrawer() {
    renderAssignmentsDrawer();
    const drawer = $('#assignments-drawer');
    const backdrop = $('#drawer-backdrop');
    drawer.removeAttribute('hidden');
    backdrop.removeAttribute('hidden');
    requestAnimationFrame(() => {
      drawer.classList.add('open');
      backdrop.classList.add('open');
    });
  }

  function closeAssignmentsDrawer() {
    const drawer = $('#assignments-drawer');
    const backdrop = $('#drawer-backdrop');
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      drawer.setAttribute('hidden', '');
      backdrop.setAttribute('hidden', '');
    }, 400);
  }

  function renderAssignmentsDrawer() {
    const body = $('#drawer-body');
    if (calendars.length === 0) {
      body.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--ink-muted)">
          <div style="font-family:var(--font-serif);font-size:22px;font-style:italic;color:var(--ink);margin-bottom:6px">No calendars</div>
          <div style="font-size:13px">Connect calendars in GoHighLevel first.</div>
        </div>
      `;
      return;
    }

    body.innerHTML = '';
    calendars.forEach(cal => {
      const assignment = assignments.find(a => a.calendar_id === cal.id);
      const assignedThemeId = assignment ? assignment.theme_id : '';
      const embedUrl = assignment ? `${BASE_URL}/embed/${LOC_ID}/${cal.id}` : '';

      const row = document.createElement('div');
      row.className = 'assignment-row';
      row.innerHTML = `
        <div class="assignment-row-head">
          <div class="assignment-cal-name">${escHtml(cal.name)}</div>
          <div class="select-wrap assignment-theme-select" style="min-width:180px">
            <select data-cal-id="${cal.id}" data-cal-name="${escHtml(cal.name)}">
              <option value="">— No theme —</option>
              ${themes.map(t => `<option value="${t.id}" ${t.id === assignedThemeId ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${embedUrl ? renderEmbedShare(embedUrl, cal.name) : ''}
      `;

      const sel = row.querySelector('select');
      sel.addEventListener('change', async (e) => {
        const themeId = e.target.value;
        if (themeId) {
          await assignTheme(themeId, cal.id, cal.name);
        } else {
          const existing = assignments.find(a => a.calendar_id === cal.id);
          if (existing) await unassignTheme(existing.id);
        }
        renderAssignmentsDrawer();
        renderGallery();
      });

      wireShareBlock(row, embedUrl, cal.name);

      body.appendChild(row);
    });
  }

  // ── Embed share block ────────────────────────────────────────────────────

  function renderEmbedShare(url, calName) {
    const safeName = (calName || 'Booking').replace(/[^\w -]/g, '').trim() || 'Booking';
    // Formats
    const formats = [
      { key: 'url',    label: 'URL' },
      { key: 'iframe', label: 'iFrame' },
      { key: 'link',   label: 'Link' },
      { key: 'script', label: 'Popup' },
    ];

    let tabs = '';
    formats.forEach((f, i) => {
      tabs += `<button class="share-tab ${i === 0 ? 'active' : ''}" data-share-tab="${f.key}">${f.label}</button>`;
    });

    return `
      <div class="share-block" data-share-url="${escHtml(url)}" data-share-name="${escHtml(safeName)}">
        <div class="share-tabs">${tabs}</div>
        <div class="share-body">
          <div class="share-code" data-share-content></div>
          <button class="share-copy" data-share-copy aria-label="Copy">
            <svg viewBox="0 0 16 16" fill="none" class="share-copy-default"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3"/></svg>
            <svg viewBox="0 0 16 16" fill="none" class="share-copy-done"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="share-copy-label">Copy</span>
          </button>
        </div>
      </div>
    `;
  }

  function wireShareBlock(row, url, calName) {
    const block = row.querySelector('.share-block');
    if (!block) return;

    const safeName = (calName || 'Booking').replace(/[^\w -]/g, '').trim() || 'Book';
    const codeEl = block.querySelector('[data-share-content]');
    const copyBtn = block.querySelector('[data-share-copy]');

    let activeKey = 'url';

    function formatFor(key) {
      switch (key) {
        case 'url':
          return url;
        case 'iframe':
          return `<iframe src="${url}" width="100%" height="720" style="border:none;max-width:760px;display:block;margin:0 auto" title="${safeName}"></iframe>`;
        case 'link':
          return `<a href="${url}" target="_blank" rel="noopener">Book a time</a>`;
        case 'script':
          return `<!-- Popup button -->\n<button onclick="window.open('${url}', '_blank', 'width=520,height=780')" style="padding:10px 18px;border:none;border-radius:8px;background:#111;color:#fff;font-weight:600;cursor:pointer">Book a time</button>`;
        default:
          return url;
      }
    }

    function renderContent() {
      codeEl.textContent = formatFor(activeKey);
    }

    block.querySelectorAll('[data-share-tab]').forEach(tab => {
      tab.onclick = () => {
        activeKey = tab.dataset.shareTab;
        block.querySelectorAll('[data-share-tab]').forEach(t => t.classList.toggle('active', t === tab));
        renderContent();
        block.classList.remove('copied');
      };
    });

    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(formatFor(activeKey));
        block.classList.add('copied');
        showToast(labelFor(activeKey) + ' copied', 'ok');
        setTimeout(() => block.classList.remove('copied'), 1600);
      } catch (e) {
        showToast('Copy failed', 'err');
      }
    };

    renderContent();
  }

  function labelFor(key) {
    return {
      url: 'URL',
      iframe: 'Embed code',
      link: 'Link HTML',
      script: 'Popup code',
    }[key] || 'Code';
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

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITOR
  // ═══════════════════════════════════════════════════════════════════════════

  function renderEditor() {
    if (!currentConfig) return;
    renderEditorTabs();
    renderEditorPanel();
  }

  function renderEditorTabs() {
    const tabs = [
      ['colors',     'Colors'],
      ['typography', 'Type'],
      ['layout',     'Layout'],
      ['time-slots', 'Slots'],
      ['form',       'Form'],
      ['components', 'UI'],
      ['animations', 'Motion'],
      ['custom-css', 'CSS'],
    ];

    const c = $('#editor-tabs');
    c.innerHTML = '';
    tabs.forEach(([id, label]) => {
      const btn = document.createElement('button');
      btn.className = `panel-tab ${id === activeEditorTab ? 'active' : ''}`;
      btn.textContent = label;
      btn.onclick = () => { activeEditorTab = id; renderEditor(); };
      c.appendChild(btn);
    });
  }

  function renderEditorPanel() {
    const body = $('#editor-body');
    body.innerHTML = '';
    switch (activeEditorTab) {
      case 'colors':     return renderColorsPanel(body);
      case 'typography': return renderTypographyPanel(body);
      case 'layout':     return renderLayoutPanel(body);
      case 'time-slots': return renderTimeSlotsPanel(body);
      case 'form':       return renderFormPanel(body);
      case 'components': return renderComponentsPanel(body);
      case 'animations': return renderAnimationsPanel(body);
      case 'custom-css': return renderCustomCssPanel(body);
    }
  }

  // Colors

  function renderColorsPanel(body) {
    const c = currentConfig.colors || {};
    const colorFields = [
      ['primary', 'Primary', c.primary],
      ['background', 'Background', c.background],
      ['text', 'Text', c.text],
      ['textMuted', 'Muted text', c.textMuted],
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
    section.innerHTML = '<div class="section-label">Color system</div>';

    const grid = document.createElement('div');
    grid.className = 'color-grid';

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
          <input class="color-hex" value="${val}" maxlength="9" data-hex-key="${key}">
        </div>
      `;
      grid.appendChild(field);
    });

    section.appendChild(grid);
    body.appendChild(section);

    body.querySelectorAll('[data-color-key]').forEach(input => {
      input.addEventListener('input', e => updateColor(e.target.dataset.colorKey, e.target.value));
    });

    body.querySelectorAll('[data-hex-key]').forEach(input => {
      input.addEventListener('input', e => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) updateColor(e.target.dataset.hexKey, e.target.value);
      });
    });
  }

  function updateColor(key, value) {
    if (!currentConfig.colors) currentConfig.colors = {};
    currentConfig.colors[key] = value;
    const swatch = $(`[data-color-key="${key}"]`);
    const hex = $(`[data-hex-key="${key}"]`);
    if (swatch) { swatch.value = value; swatch.parentElement.style.background = value; }
    if (hex) hex.value = value;
    updatePreview();
  }

  // Typography

  function renderTypographyPanel(body) {
    const t = currentConfig.typography || {};
    body.innerHTML = `
      <div class="section">
        <div class="section-label">Typography</div>
        <div class="field">
          <label>Font family</label>
          <div class="select-wrap">
            <select id="ed-fontFamily">
              <option value="'Plus Jakarta Sans', sans-serif" ${t.fontFamily?.includes('Jakarta') ? 'selected' : ''}>Plus Jakarta Sans</option>
              <option value="'DM Sans', sans-serif" ${t.fontFamily?.includes('DM Sans') ? 'selected' : ''}>DM Sans</option>
              <option value="'Inter', sans-serif" ${t.fontFamily?.includes('Inter') ? 'selected' : ''}>Inter</option>
              <option value="'Poppins', sans-serif" ${t.fontFamily?.includes('Poppins') ? 'selected' : ''}>Poppins</option>
              <option value="'Instrument Serif', serif" ${t.fontFamily?.includes('Instrument') ? 'selected' : ''}>Instrument Serif</option>
              <option value="'Georgia', serif" ${t.fontFamily?.includes('Georgia') ? 'selected' : ''}>Georgia</option>
              <option value="system-ui, sans-serif" ${t.fontFamily?.includes('system-ui') ? 'selected' : ''}>System</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Heading size</label>
          <div class="slider-row">
            <input type="range" id="ed-headingSize" min="14" max="32" value="${parseInt(t.headingSize) || 18}">
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
          <label>Body weight</label>
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
      el.addEventListener('input', e => {
        const slider = e.target.closest('.slider-row');
        if (slider) slider.querySelector('.slider-val').textContent = e.target.value + 'px';
        onChange();
      });
    });
  }

  // Layout

  function renderLayoutPanel(body) {
    const l = currentConfig.layout || {};
    const stepsOrder = l.stepsOrder || ['calendar', 'time', 'form', 'confirm'];

    const flowPresets = [
      { id: 'date-time-form',   label: 'Date → Time → Form',     steps: ['calendar', 'time', 'form', 'confirm'] },
      { id: 'time-date-form',   label: 'Time → Date → Form',     steps: ['time', 'calendar', 'form', 'confirm'] },
      { id: 'date-time-inline', label: 'Date + Time → Form',     steps: ['calendar+time', 'form', 'confirm'] },
    ];

    const currentFlowId = getFlowPresetId(stepsOrder, flowPresets);

    let flowHtml = '';
    flowPresets.forEach(fp => {
      flowHtml += `
        <div class="option-card ${fp.id === currentFlowId ? 'active' : ''}" data-flow="${fp.id}">
          <div>${fp.label}</div>
        </div>
      `;
    });

    let stepListHtml = '';
    stepsOrder.forEach((step, i) => {
      stepListHtml += `
        <div class="step-order-item" data-step="${step}">
          <span class="step-order-handle">≡</span>
          <span class="step-order-label">${stepLabel(step)}</span>
          <div class="step-order-arrows">
            <button class="icon-btn" data-move-step="${i}" data-dir="-1" aria-label="Move up">↑</button>
            <button class="icon-btn" data-move-step="${i}" data-dir="1" aria-label="Move down">↓</button>
          </div>
        </div>
      `;
    });

    body.innerHTML = `
      <div class="section">
        <div class="section-label">Layout mode</div>
        <div class="option-cards">
          <div class="option-card ${l.type === 'multi-step' || !l.type ? 'active' : ''}" data-layout="multi-step">Multi-step</div>
          <div class="option-card ${l.type === 'single-page' ? 'active' : ''}" data-layout="single-page">Single page</div>
          <div class="option-card ${l.type === 'sidebar' ? 'active' : ''}" data-layout="sidebar">Sidebar</div>
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
          <label>Corner radius</label>
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

    body.querySelectorAll('[data-layout]').forEach(card => {
      card.onclick = () => {
        if (!currentConfig.layout) currentConfig.layout = {};
        currentConfig.layout.type = card.dataset.layout;
        body.querySelectorAll('[data-layout]').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        updatePreview();
      };
    });

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

    body.querySelectorAll('[data-move-step]').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.moveStep);
        const dir = parseInt(btn.dataset.dir);
        const steps = currentConfig.layout?.stepsOrder || ['calendar', 'time', 'form', 'confirm'];
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= steps.length) return;
        if (steps[idx] === 'confirm' || steps[newIdx] === 'confirm') return;
        [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
        if (!currentConfig.layout) currentConfig.layout = {};
        currentConfig.layout.stepsOrder = steps;
        renderEditor();
        updatePreview();
      };
    });

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

    body.querySelector('#ed-firstDay').addEventListener('change', (e) => {
      if (!currentConfig.calendar) currentConfig.calendar = {};
      currentConfig.calendar.firstDayOfWeek = parseInt(e.target.value);
      updatePreview();
    });
  }

  function getFlowPresetId(steps, presets) {
    const key = steps.join(',');
    for (const p of presets) if (p.steps.join(',') === key) return p.id;
    return null;
  }

  function stepLabel(step) {
    return {
      'calendar': 'Date picker',
      'time': 'Time slots',
      'form': 'Booking form',
      'confirm': 'Confirmation',
      'calendar+time': 'Date + Time',
    }[step] || step;
  }

  // Time Slots

  function renderTimeSlotsPanel(body) {
    const ts = currentConfig.timeSlots || {};
    body.innerHTML = `
      <div class="section">
        <div class="section-label">Slot style</div>
        <div class="option-cards">
          <div class="option-card ${ts.style === 'pills' || !ts.style ? 'active' : ''}" data-slot-style="pills">Pills</div>
          <div class="option-card ${ts.style === 'list' ? 'active' : ''}" data-slot-style="list">List</div>
          <div class="option-card ${ts.style === 'grid' ? 'active' : ''}" data-slot-style="grid">Grid</div>
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

  // Form

  function renderFormPanel(body) {
    const fields = (currentConfig.form && currentConfig.form.fields) || [];
    let html = '<div class="section"><div class="section-label">Booking form fields</div><div class="form-fields-list">';

    fields.forEach((f, i) => {
      html += `
        <div class="form-field-item">
          <div class="field-info">
            <div class="field-name">${escHtml(f.label || f.name)}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</div>
            <div class="field-type">${f.type || 'text'}</div>
          </div>
          <div class="field-actions">
            <button class="icon-btn" onclick="window._builder.moveFormField(${i}, -1)" aria-label="Up">↑</button>
            <button class="icon-btn" onclick="window._builder.moveFormField(${i}, 1)" aria-label="Down">↓</button>
            <button class="icon-btn danger" onclick="window._builder.removeFormField(${i})" aria-label="Remove">×</button>
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
    const name = prompt('Field name (e.g. "company")');
    if (!name) return;
    const label = prompt('Label', name.charAt(0).toUpperCase() + name.slice(1));
    const type = prompt('Type (text, email, tel, textarea, select)', 'text') || 'text';
    if (!currentConfig.form) currentConfig.form = { fields: [] };
    currentConfig.form.fields.push({ name, label: label || name, type, required: false, placeholder: '' });
    renderEditor();
    updatePreview();
  }

  function removeFormField(index) {
    if (!currentConfig.form?.fields) return;
    currentConfig.form.fields.splice(index, 1);
    renderEditor();
    updatePreview();
  }

  function moveFormField(index, direction) {
    if (!currentConfig.form?.fields) return;
    const fields = currentConfig.form.fields;
    const ni = index + direction;
    if (ni < 0 || ni >= fields.length) return;
    [fields[index], fields[ni]] = [fields[ni], fields[index]];
    renderEditor();
    updatePreview();
  }

  // Components

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
        <div class="section-label">Copy</div>
        <div class="field">
          <label>Header text</label>
          <input type="text" id="ed-headerText" value="${escHtml(comp.headerText || 'Book an Appointment')}">
        </div>
        <div class="field">
          <label>Confirm button</label>
          <input type="text" id="ed-confirmBtn" value="${escHtml(comp.confirmButtonText || 'Confirm Booking')}">
        </div>
        <div class="field">
          <label>Success message</label>
          <textarea id="ed-successMsg" rows="2">${escHtml(comp.successMessage || "You're all set! Check your email for confirmation.")}</textarea>
        </div>
      </div>
    `;

    body.querySelectorAll('[data-toggle]').forEach(toggle => {
      toggle.onclick = () => {
        toggle.classList.toggle('on');
        if (!currentConfig.components) currentConfig.components = {};
        currentConfig.components[toggle.dataset.toggle] = toggle.classList.contains('on');
        updatePreview();
      };
    });

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

  // Animations

  function renderAnimationsPanel(body) {
    const a = currentConfig.animations || {};
    body.innerHTML = `
      <div class="section">
        <div class="section-label">Motion</div>
        <div class="field">
          <label>Transition speed</label>
          <div class="slider-row">
            <input type="range" id="ed-transSpeed" min="0" max="1" step="0.05" value="${parseFloat(a.transitionSpeed) || 0.2}">
            <span class="slider-val">${parseFloat(a.transitionSpeed) || 0.2}s</span>
          </div>
        </div>
        <div class="field">
          <label>Step transition</label>
          <div class="select-wrap">
            <select id="ed-stepTrans">
              <option value="slide-left" ${a.stepTransition === 'slide-left' || !a.stepTransition ? 'selected' : ''}>Slide</option>
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

  // Custom CSS

  function renderCustomCssPanel(body) {
    body.innerHTML = `
      <div class="section">
        <div class="section-label">Custom CSS</div>
        <div class="field">
          <textarea class="code-input" id="ed-customCss" rows="16" placeholder="/* Override any styles here */&#10;.ct-slot { ... }">${escHtml(currentConfig.customCss || '')}</textarea>
        </div>
      </div>
    `;
    body.querySelector('#ed-customCss').addEventListener('input', (e) => {
      currentConfig.customCss = e.target.value;
      updatePreview();
    });
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  function applyFrameClasses() {
    const frame = $('#preview-frame');
    if (!frame || !currentConfig) return;
    const layout = currentConfig.layout?.type || 'multi-step';
    const steps = currentConfig.layout?.stepsOrder || [];
    const hasCombined = steps.includes('calendar+time');

    const classes = ['preview-frame', `device-${previewDevice}`];
    if (layout === 'sidebar') classes.push('layout-sidebar');
    if (layout === 'single-page') classes.push('layout-single-page');
    if (hasCombined) classes.push('flow-combined');

    frame.className = classes.join(' ');
  }

  function renderPreview() {
    const frame = $('#preview-frame');
    frame.innerHTML = '';
    applyFrameClasses();
    previewRenderer = new CalendarRenderer(frame, currentConfig, { previewMode: true });
    previewRenderer.init();
  }

  function updatePreview() {
    applyFrameClasses();
    if (previewRenderer) previewRenderer.updateConfig(currentConfig);
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function saveTheme() {
    if (!LOC_ID) { showToast('No location ID', 'err'); return; }
    if (!currentThemeId) { showToast('No theme selected', 'err'); return; }

    const btn = $('#save-btn');
    const lbl = $('#save-label');
    const status = $('#save-status');
    btn.classList.add('saving');
    lbl.textContent = 'Saving…';
    status.textContent = '';

    const name = ($('#theme-name-input').value || '').trim() || 'Untitled theme';

    try {
      const res = await fetch(`${BASE_URL}/api/themes/${LOC_ID}/${currentThemeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: currentConfig }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();

      const idx = themes.findIndex(t => t.id === currentThemeId);
      if (idx >= 0) themes[idx] = updated;

      btn.classList.remove('saving');
      lbl.textContent = 'Save';
      status.textContent = 'Saved';
      setTimeout(() => { status.textContent = ''; }, 2500);
      showToast('Theme saved', 'ok');
    } catch (e) {
      btn.classList.remove('saving');
      lbl.textContent = 'Save';
      showToast('Save failed: ' + e.message, 'err');
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatDate(ts) {
    if (!ts) return 'Recently';
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return 'Recently';
    const now = Date.now();
    const diff = now - d.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (diff < day) return 'Today';
    if (diff < 2 * day) return 'Yesterday';
    if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  let toastTimer;
  function showToast(msg, type = 'ok') {
    const t = $('#toast');
    t.querySelector('.toast-msg').textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  function copyUrl(url) {
    navigator.clipboard.writeText(url).then(() => showToast('URL copied', 'ok'));
  }

  // ── Expose globals for inline handlers ───────────────────────────────────

  window._builder = {
    addFormField,
    removeFormField,
    moveFormField,
    copyUrl,
  };

  // ── Wire events ──────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    $('#new-theme-btn').onclick = openPresetModal;
    $('#empty-new-btn').onclick = openPresetModal;
    $('#back-btn').onclick = backToGallery;
    $('#save-btn').onclick = saveTheme;
    $('#nav-assignments-btn').onclick = openAssignmentsDrawer;
    $('#editor-assignments-btn').onclick = openAssignmentsDrawer;
    $('#drawer-close').onclick = closeAssignmentsDrawer;
    $('#drawer-backdrop').onclick = closeAssignmentsDrawer;
    $('#preset-close').onclick = closePresetModal;
    $('#preset-backdrop').onclick = closePresetModal;

    // Theme name input
    const nameInput = $('#theme-name-input');
    let nameTimer;
    nameInput.addEventListener('input', () => {
      const status = $('#save-status');
      status.textContent = 'Unsaved changes';
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => { /* autosave on blur only */ }, 500);
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); saveTheme(); }
      if (e.key === 'Escape') { const t = themes.find(t => t.id === currentThemeId); if (t) nameInput.value = t.name || ''; nameInput.blur(); }
    });

    // Search
    $('#search-input').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderGallery();
    });

    // Device switch
    $$('#device-switch .device-btn').forEach(btn => {
      btn.onclick = () => {
        previewDevice = btn.dataset.device;
        $$('#device-switch .device-btn').forEach(b => b.classList.toggle('active', b === btn));
        applyFrameClasses();
      };
    });

    // Mobile edit/preview toggle
    document.body.classList.add('mv-edit');
    $$('.mobile-switch .ms-btn').forEach(btn => {
      btn.onclick = () => {
        const view = btn.dataset.mobileView;
        $$('.mobile-switch .ms-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.body.classList.remove('mv-edit', 'mv-preview');
        document.body.classList.add(`mv-${view}`);
      };
    });

    // Escape closes modal/drawer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#preset-modal').hasAttribute('hidden')) closePresetModal();
        else if (!$('#assignments-drawer').hasAttribute('hidden')) closeAssignmentsDrawer();
      }
    });
  });

  boot();
})();
