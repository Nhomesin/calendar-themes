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
  let calendarGroups = [];
  let assignments = [];
  let previewRenderer = null;
  let presets = [];
  let activeEditorTab = 'colors';
  let searchQuery = '';
  let previewDevice = 'desktop';
  let editingFieldIndex = -1;
  let addingFormField = false;
  let drawerSearchQuery = '';
  const drawerCollapsed = new Set();
  let drawerWired = false;
  // calendarId -> { status: 'loading'|'ok'|'error'|'none', formId, formName, fieldCount }
  const formInfoByCal = new Map();
  const formInfoInflight = new Map();

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function boot() {
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
      if (calRes.ok) {
        const calData = await calRes.json();
        calendars = calData.calendars || [];
        calendarGroups = calData.groups || [];
      }
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
            <div class="theme-card-swatch"><span style="background:${colors.primary || '#3730A3'}"></span></div>
            <div class="theme-card-swatch"><span style="background:${colors.background || '#FFFFFF'}"></span></div>
            <div class="theme-card-swatch"><span style="background:${colors.buttonBg || colors.primary || '#3730A3'}"></span></div>
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
    if (!drawerWired) {
      wireDrawerSearch();
      wirePixelInstallCard();
      drawerWired = true;
    }
    drawerSearchQuery = '';
    const input = $('#drawer-search-input');
    const clear = $('#drawer-search-clear');
    if (input) input.value = '';
    if (clear) clear.hidden = true;

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

  function wireDrawerSearch() {
    const input = $('#drawer-search-input');
    const clear = $('#drawer-search-clear');
    if (!input || !clear) return;

    input.addEventListener('input', (e) => {
      drawerSearchQuery = e.target.value;
      clear.hidden = !drawerSearchQuery;
      renderAssignmentsDrawer();
    });
    clear.addEventListener('click', () => {
      input.value = '';
      drawerSearchQuery = '';
      clear.hidden = true;
      renderAssignmentsDrawer();
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerSearchQuery) {
        // Swallow Escape so it clears search instead of closing the drawer.
        e.stopPropagation();
        input.value = '';
        drawerSearchQuery = '';
        clear.hidden = true;
        renderAssignmentsDrawer();
      }
    });
  }

  function wirePixelInstallCard() {
    const block = $('#pixel-snippet-block');
    const codeEl = document.querySelector('[data-pixel-code]');
    const copyBtn = document.querySelector('[data-pixel-copy]');
    if (!block || !codeEl || !copyBtn) return;

    // Split the closing tag so the surrounding HTML parser doesn't treat
    // this as a real </script>.
    const snippet = '<script src="' + BASE_URL + '/pixel.js" async><' + '/script>';
    codeEl.textContent = snippet;

    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(snippet);
        block.classList.add('copied');
        showToast('Pixel snippet copied', 'ok');
        setTimeout(() => block.classList.remove('copied'), 1600);
      } catch (e) {
        showToast('Copy failed', 'err');
      }
    };
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

    const q = drawerSearchQuery.trim().toLowerCase();
    const filteredCals = q
      ? calendars.filter(c => (c.name || '').toLowerCase().includes(q))
      : calendars.slice();

    if (filteredCals.length === 0) {
      body.innerHTML = `
        <div class="drawer-empty">
          <div class="drawer-empty-title">No calendars match</div>
          <div class="drawer-empty-sub">Try a different search term.</div>
        </div>
      `;
      return;
    }

    const groupsForRender = buildDrawerGroups(filteredCals);
    const searching = !!q;
    body.innerHTML = '';

    groupsForRender.forEach(grp => {
      const collapsed = !searching && drawerCollapsed.has(grp.key);
      const section = document.createElement('section');
      section.className = 'assign-group' + (collapsed ? ' collapsed' : '');
      section.dataset.groupKey = grp.key;
      section.innerHTML = `
        <button type="button" class="assign-group-head" aria-expanded="${!collapsed}">
          <svg class="assign-group-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4 3l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="assign-group-name">${escHtml(grp.label)}</span>
          <span class="assign-group-count">${grp.calendars.length}</span>
        </button>
        <div class="assign-group-body"></div>
      `;

      const bodyEl = section.querySelector('.assign-group-body');
      grp.calendars.forEach(cal => bodyEl.appendChild(buildAssignmentRow(cal)));

      section.querySelector('.assign-group-head').addEventListener('click', () => {
        if (drawerCollapsed.has(grp.key)) drawerCollapsed.delete(grp.key);
        else drawerCollapsed.add(grp.key);
        const nowCollapsed = drawerCollapsed.has(grp.key);
        section.classList.toggle('collapsed', nowCollapsed);
        section.querySelector('.assign-group-head').setAttribute('aria-expanded', String(!nowCollapsed));
      });

      body.appendChild(section);
    });
  }

  // Group calendars for the drawer. Prefers GHL calendar groups; falls back to
  // an A–Z bucketed list when the location has no groups configured.
  function buildDrawerGroups(cals) {
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    const sorted = cals.slice().sort(byName);

    if (calendarGroups && calendarGroups.length) {
      const groupsById = new Map();
      calendarGroups.forEach(g => groupsById.set(g.id, g));

      const bucket = new Map();
      sorted.forEach(cal => {
        const gid = cal.groupId || cal.calendarGroupId || '';
        const key = gid || '__ungrouped__';
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key).push(cal);
      });

      const keys = [...bucket.keys()];
      keys.sort((a, b) => {
        if (a === '__ungrouped__') return 1;
        if (b === '__ungrouped__') return -1;
        const ga = groupsById.get(a);
        const gb = groupsById.get(b);
        return (ga?.name || '').localeCompare(gb?.name || '', undefined, { sensitivity: 'base' });
      });

      return keys.map(key => {
        const cals = bucket.get(key);
        if (key === '__ungrouped__') {
          return { key, label: 'Ungrouped', calendars: cals };
        }
        const g = groupsById.get(key);
        return { key, label: g?.name || 'Calendar group', calendars: cals };
      });
    }

    // Fallback: bucket alphabetically by first letter of calendar name.
    const bucket = new Map();
    sorted.forEach(cal => {
      const ch = (cal.name || '').trim().charAt(0).toUpperCase();
      const key = /[A-Z]/.test(ch) ? ch : '#';
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(cal);
    });
    const keys = [...bucket.keys()].sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    return keys.map(key => ({ key: 'az:' + key, label: key, calendars: bucket.get(key) }));
  }

  function buildAssignmentRow(cal) {
    const assignment = assignments.find(a => a.calendar_id === cal.id);
    const assignedThemeId = assignment ? assignment.theme_id : '';
    const embedUrl = assignment ? `${BASE_URL}/embed/${LOC_ID}/${cal.id}` : '';

    const row = document.createElement('div');
    row.className = 'assignment-row';
    row.dataset.calId = cal.id;
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
      <div class="assignment-form-meta" data-form-meta="${cal.id}" ${assignment ? '' : 'hidden'}></div>
      ${embedUrl ? renderEmbedShare(embedUrl, cal.name) : ''}
    `;

    if (assignment) {
      renderCalendarFormMeta(row, cal.id);
      ensureCalendarFormInfo(cal.id);
    }

    const sel = row.querySelector('select');
    sel.addEventListener('change', async (e) => {
      const themeId = e.target.value;
      if (themeId) {
        await assignTheme(themeId, cal.id, cal.name);
        // Invalidate + refetch so the meta line reflects the current form.
        formInfoByCal.delete(cal.id);
        formInfoInflight.delete(cal.id);
        ensureCalendarFormInfo(cal.id);
      } else {
        const existing = assignments.find(a => a.calendar_id === cal.id);
        if (existing) await unassignTheme(existing.id);
      }
      renderAssignmentsDrawer();
      renderGallery();
    });

    wireShareBlock(row, embedUrl, cal.name);

    return row;
  }

  function ensureCalendarFormInfo(calendarId) {
    if (!LOC_ID) return;
    if (formInfoByCal.has(calendarId)) return;
    if (formInfoInflight.has(calendarId)) return;

    formInfoByCal.set(calendarId, { status: 'loading' });
    updateFormMetaRow(calendarId);

    const p = fetch(`${BASE_URL}/api/calendars/${LOC_ID}/${calendarId}/form`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !data.meta) {
          formInfoByCal.set(calendarId, { status: 'error' });
        } else if (!data.meta.formId) {
          formInfoByCal.set(calendarId, { status: 'none', ...data.meta, fieldCount: (data.fields || []).length });
        } else {
          formInfoByCal.set(calendarId, {
            status: 'ok',
            formId: data.meta.formId,
            formName: data.meta.formName,
            fieldCount: (data.fields || []).length,
            customFieldCount: data.meta.customFieldCount || 0,
          });
        }
      })
      .catch(() => { formInfoByCal.set(calendarId, { status: 'error' }); })
      .finally(() => {
        formInfoInflight.delete(calendarId);
        updateFormMetaRow(calendarId);
      });

    formInfoInflight.set(calendarId, p);
  }

  function updateFormMetaRow(calendarId) {
    const el = document.querySelector(`[data-form-meta="${calendarId}"]`);
    if (!el) return;
    renderCalendarFormMeta(el.closest('.assignment-row'), calendarId);
  }

  function renderCalendarFormMeta(row, calendarId) {
    if (!row) return;
    const el = row.querySelector('[data-form-meta]');
    if (!el) return;

    const info = formInfoByCal.get(calendarId);
    if (!info || info.status === 'loading') {
      el.className = 'assignment-form-meta loading';
      el.innerHTML = `
        <svg class="form-meta-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" opacity=".4"/><path d="M8 2a6 6 0 016 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <span>Reading calendar form…</span>
      `;
      return;
    }

    if (info.status === 'error') {
      el.className = 'assignment-form-meta error';
      el.innerHTML = `
        <svg class="form-meta-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 5.5v3.5M8 11v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>Couldn't read form — check that the install has forms.readonly + locations/customFields.readonly scopes.</span>
      `;
      return;
    }

    if (info.status === 'none') {
      el.className = 'assignment-form-meta muted';
      el.innerHTML = `
        <svg class="form-meta-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7h5M5.5 10h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        <span>No form attached in GHL · using default form (name, email, phone, notes)</span>
      `;
      return;
    }

    // status === 'ok'
    el.className = 'assignment-form-meta';
    const label = info.formName ? escHtml(info.formName) : `form ${escHtml(String(info.formId).slice(0, 6))}…`;
    const customLine = info.customFieldCount
      ? ` · ${info.customFieldCount} custom field${info.customFieldCount === 1 ? '' : 's'}`
      : '';
    el.innerHTML = `
      <svg class="form-meta-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="2.5" width="10" height="11" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 6h5M5.5 9h5M5.5 12h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      <span>Form: <strong>${label}</strong>${customLine}</span>
    `;
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
    const colorGroups = [
      ['Brand', [
        ['primary', 'Primary', c.primary],
        ['accent', 'Accent', c.accent],
      ]],
      ['Surface', [
        ['background', 'Background', c.background],
        ['hoverBg', 'Hover', c.hoverBg],
        ['border', 'Border', c.border],
      ]],
      ['Text', [
        ['text', 'Text', c.text],
        ['textMuted', 'Muted', c.textMuted],
      ]],
      ['Action', [
        ['buttonBg', 'Button', c.buttonBg],
        ['buttonText', 'Button text', c.buttonText],
        ['selectedBg', 'Selected', c.selectedBg],
        ['selectedText', 'Selected text', c.selectedText],
        ['todayRing', 'Today ring', c.todayRing],
      ]],
      ['Status', [
        ['error', 'Error', c.error],
        ['success', 'Success', c.success],
      ]],
    ];

    body.insertAdjacentHTML('beforeend', sectionHeader('Color system', 'Tokens that drive every themed surface · opacity supported'));

    colorGroups.forEach(([groupName, fields]) => {
      const section = document.createElement('div');
      section.className = 'section color-section';
      section.innerHTML = `<div class="color-section-head">${groupName}</div>`;

      const grid = document.createElement('div');
      grid.className = 'color-grid';

      fields.forEach(([key, label, value]) => {
        const val = value || '#000000';
        const { hex, alpha } = parseColorValue(val);
        const field = document.createElement('div');
        field.className = 'color-field';
        field.innerHTML = `
          <span class="color-label">${label}</span>
          <div class="color-row">
            <div class="color-swatch">
              <div class="color-swatch-fill" data-swatch-fill="${key}" style="background:${val}"></div>
              <input type="color" value="${hex}" data-color-key="${key}" aria-label="${label} color picker">
            </div>
            <input class="color-hex" value="${val}" maxlength="9" spellcheck="false" data-hex-key="${key}" aria-label="${label} hex">
            <input class="color-alpha" type="range" min="0" max="100" value="${alpha}" step="1" data-alpha-key="${key}" aria-label="${label} opacity" title="Opacity ${alpha}%">
          </div>
        `;
        grid.appendChild(field);
      });

      section.appendChild(grid);
      body.appendChild(section);
    });

    body.querySelectorAll('[data-color-key]').forEach(input => {
      input.addEventListener('input', e => {
        const key = e.target.dataset.colorKey;
        const alphaEl = body.querySelector(`[data-alpha-key="${key}"]`);
        const alpha = alphaEl ? parseInt(alphaEl.value, 10) : 100;
        updateColor(key, formatColorValue(e.target.value, alpha));
      });
    });

    body.querySelectorAll('[data-hex-key]').forEach(input => {
      input.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(v)) {
          updateColor(e.target.dataset.hexKey, v.toUpperCase());
        }
      });
    });

    body.querySelectorAll('[data-alpha-key]').forEach(input => {
      input.addEventListener('input', e => {
        const key = e.target.dataset.alphaKey;
        const stored = (currentConfig.colors || {})[key] || '#000000';
        const { hex } = parseColorValue(stored);
        updateColor(key, formatColorValue(hex, parseInt(e.target.value, 10)));
      });
    });
  }

  function parseColorValue(value) {
    if (!value) return { hex: '#000000', alpha: 100 };
    const v = String(value).trim();
    if (v.toLowerCase() === 'transparent') return { hex: '#000000', alpha: 0 };
    const m = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/.exec(v);
    if (!m) return { hex: '#000000', alpha: 100 };
    const hex = '#' + m[1].toUpperCase();
    const alpha = m[2] ? Math.round((parseInt(m[2], 16) / 255) * 100) : 100;
    return { hex, alpha };
  }

  function formatColorValue(hex, alpha) {
    const clean = (hex || '#000000').toUpperCase();
    const a = Math.max(0, Math.min(100, alpha || 0));
    if (a >= 100) return clean;
    const aa = Math.round((a / 100) * 255).toString(16).padStart(2, '0').toUpperCase();
    return `${clean}${aa}`;
  }

  function updateColor(key, value) {
    if (!currentConfig.colors) currentConfig.colors = {};
    currentConfig.colors[key] = value;
    const { hex, alpha } = parseColorValue(value);

    const picker = $(`[data-color-key="${key}"]`);
    const hexInput = $(`[data-hex-key="${key}"]`);
    const alphaInput = $(`[data-alpha-key="${key}"]`);
    const fill = $(`[data-swatch-fill="${key}"]`);

    if (picker) picker.value = hex;
    if (hexInput && document.activeElement !== hexInput) hexInput.value = value;
    if (alphaInput) {
      alphaInput.value = alpha;
      alphaInput.title = `Opacity ${alpha}%`;
    }
    if (fill) fill.style.background = value;
    updatePreview();
  }

  // Typography

  function renderTypographyPanel(body) {
    const t = currentConfig.typography || {};
    const fontOptions = [
      { value: "'Plus Jakarta Sans', sans-serif", label: 'Plus Jakarta Sans', key: 'Jakarta' },
      { value: "'DM Sans', sans-serif",           label: 'DM Sans',           key: 'DM Sans' },
      { value: "'Inter', sans-serif",             label: 'Inter',             key: 'Inter' },
      { value: "'Poppins', sans-serif",           label: 'Poppins',           key: 'Poppins' },
      { value: "'Instrument Serif', serif",       label: 'Instrument Serif',  key: 'Instrument' },
      { value: "'Georgia', serif",                label: 'Georgia',           key: 'Georgia' },
      { value: 'system-ui, sans-serif',           label: 'System UI',         key: 'system-ui' },
    ];
    const currentFont = fontOptions.find(f => t.fontFamily?.includes(f.key)) || fontOptions[0];
    const headingSize = parseInt(t.headingSize) || 18;
    const bodySize = parseInt(t.bodySize) || 14;
    const headingWeight = t.headingWeight || '600';
    const bodyWeight = t.fontWeight || '500';

    body.innerHTML = `
      ${sectionHeader('Font family', 'Picks a Google Font that applies across the widget')}
      <div class="section">
        <div class="field">
          <div class="select-wrap">
            <select id="ed-fontFamily">
              ${fontOptions.map(f => `<option value="${f.value}" ${f.key === currentFont.key ? 'selected' : ''}>${f.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="font-preview" id="font-preview" style="font-family:${currentFont.value}">
          <div class="font-preview-heading" style="font-weight:${headingWeight};font-size:${Math.max(20, headingSize)}px">Book an appointment</div>
          <div class="font-preview-body" style="font-weight:${bodyWeight};font-size:${bodySize}px">The quick brown fox jumps over the lazy dog.</div>
        </div>
      </div>

      ${sectionHeader('Scale', 'Type sizing for heading and body copy')}
      <div class="section">
        <div class="field">
          <label>Heading size</label>
          <div class="slider-row">
            <input type="range" id="ed-headingSize" min="14" max="32" value="${headingSize}">
            <span class="slider-val">${headingSize}px</span>
          </div>
        </div>
        <div class="field">
          <label>Body size</label>
          <div class="slider-row">
            <input type="range" id="ed-bodySize" min="11" max="18" value="${bodySize}">
            <span class="slider-val">${bodySize}px</span>
          </div>
        </div>
      </div>

      ${sectionHeader('Weight', 'Emphasis for headings and body text')}
      <div class="section">
        <div class="field">
          <label>Body weight</label>
          <div class="select-wrap">
            <select id="ed-fontWeight">
              <option value="400" ${bodyWeight === '400' ? 'selected' : ''}>Regular (400)</option>
              <option value="500" ${bodyWeight === '500' ? 'selected' : ''}>Medium (500)</option>
              <option value="600" ${bodyWeight === '600' ? 'selected' : ''}>Semibold (600)</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Heading weight</label>
          <div class="select-wrap">
            <select id="ed-headingWeight">
              <option value="500" ${headingWeight === '500' ? 'selected' : ''}>Medium (500)</option>
              <option value="600" ${headingWeight === '600' ? 'selected' : ''}>Semibold (600)</option>
              <option value="700" ${headingWeight === '700' ? 'selected' : ''}>Bold (700)</option>
            </select>
          </div>
        </div>
      </div>
    `;

    const preview = body.querySelector('#font-preview');
    const previewH = preview.querySelector('.font-preview-heading');
    const previewB = preview.querySelector('.font-preview-body');

    const onChange = () => {
      if (!currentConfig.typography) currentConfig.typography = {};
      const ff = body.querySelector('#ed-fontFamily').value;
      const hs = body.querySelector('#ed-headingSize').value;
      const bs = body.querySelector('#ed-bodySize').value;
      const bw = body.querySelector('#ed-fontWeight').value;
      const hw = body.querySelector('#ed-headingWeight').value;

      currentConfig.typography.fontFamily = ff;
      currentConfig.typography.headingSize = hs + 'px';
      currentConfig.typography.bodySize = bs + 'px';
      currentConfig.typography.fontWeight = bw;
      currentConfig.typography.headingWeight = hw;

      preview.style.fontFamily = ff;
      previewH.style.fontWeight = hw;
      previewH.style.fontSize = Math.max(20, parseInt(hs)) + 'px';
      previewB.style.fontWeight = bw;
      previewB.style.fontSize = bs + 'px';
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
      { id: 'date-time-form',   label: 'Date → Time → Form',     sub: 'Classic linear booking',     steps: ['calendar', 'time', 'form', 'confirm'] },
      { id: 'time-date-form',   label: 'Time → Date → Form',     sub: 'Lead with availability',     steps: ['time', 'calendar', 'form', 'confirm'] },
      { id: 'date-time-inline', label: 'Date + Time → Form',     sub: 'Combined scheduler view',    steps: ['calendar+time', 'form', 'confirm'] },
    ];

    const currentFlowId = getFlowPresetId(stepsOrder, flowPresets);

    const layoutOptions = [
      { id: 'multi-step',  label: 'Multi-step',  desc: 'One step at a time', icon: layoutIcon('multi') },
      { id: 'single-page', label: 'Single page', desc: 'All in one view',    icon: layoutIcon('single') },
      { id: 'sidebar',     label: 'Sidebar',     desc: 'Split two-column',   icon: layoutIcon('sidebar') },
    ];

    const layoutHtml = layoutOptions.map(opt => `
      <button class="option-card visual ${(l.type || 'multi-step') === opt.id ? 'active' : ''}" data-layout="${opt.id}" type="button">
        <div class="option-visual">${opt.icon}</div>
        <div class="option-text">
          <div class="option-card-label">${opt.label}</div>
          <div class="option-card-sub">${opt.desc}</div>
        </div>
      </button>
    `).join('');

    const flowHtml = flowPresets.map(fp => `
      <button class="option-card flow-card ${fp.id === currentFlowId ? 'active' : ''}" data-flow="${fp.id}" type="button">
        <div class="option-text">
          <div class="option-card-label">${fp.label}</div>
          <div class="option-card-sub">${fp.sub}</div>
        </div>
        <span class="option-check" aria-hidden="true">${checkIconSvg()}</span>
      </button>
    `).join('');

    const stepListHtml = stepsOrder.map((step, i) => `
      <div class="step-order-item" data-step="${step}">
        <span class="step-order-handle">${gripIconSvg()}</span>
        <span class="step-order-index">${i + 1}</span>
        <span class="step-order-label">${stepLabel(step)}</span>
        <div class="step-order-arrows">
          <button class="icon-btn" data-move-step="${i}" data-dir="-1" aria-label="Move up" title="Move up">${arrowUpSvg()}</button>
          <button class="icon-btn" data-move-step="${i}" data-dir="1" aria-label="Move down" title="Move down">${arrowDownSvg()}</button>
        </div>
      </div>
    `).join('');

    body.innerHTML = `
      ${sectionHeader('Layout mode', 'Pick how the booking flow presents itself')}
      <div class="section">
        <div class="option-cards option-cards-visual">${layoutHtml}</div>
      </div>

      ${sectionHeader('Booking flow', 'Reorder steps or pick a flow preset')}
      <div class="section">
        <div class="option-cards flow-cards">${flowHtml}</div>
        <div class="step-order-list">${stepListHtml}</div>
      </div>

      ${sectionHeader('Spacing', 'Rhythm & rounding for the whole widget')}
      <div class="section">
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

      ${sectionHeader('Calendar', 'Regional basics')}
      <div class="section">
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
    const styleOptions = [
      { id: 'pills', label: 'Pills', desc: 'Compact rounded buttons', icon: slotIcon('pills') },
      { id: 'list',  label: 'List',  desc: 'Full-width stacked rows', icon: slotIcon('list') },
      { id: 'grid',  label: 'Grid',  desc: 'Square card layout',       icon: slotIcon('grid') },
    ];
    const current = ts.style || 'pills';

    const optionsHtml = styleOptions.map(opt => `
      <button class="option-card visual ${opt.id === current ? 'active' : ''}" data-slot-style="${opt.id}" type="button">
        <div class="option-visual">${opt.icon}</div>
        <div class="option-text">
          <div class="option-card-label">${opt.label}</div>
          <div class="option-card-sub">${opt.desc}</div>
        </div>
      </button>
    `).join('');

    body.innerHTML = `
      ${sectionHeader('Slot style', 'Shape and spacing for time-slot buttons')}
      <div class="section">
        <div class="option-cards option-cards-visual">${optionsHtml}</div>
      </div>
      ${sectionHeader('Columns', 'How many slots per row')}
      <div class="section">
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
    if (!currentConfig.form) currentConfig.form = {};
    // Default to calendar-sourced fields — that's what the user expects on a
    // fresh theme. Users who've already customized fields still see 'custom'
    // because they explicitly opted in at some point.
    if (currentConfig.form.source !== 'custom') currentConfig.form.source = 'calendar';

    const source = currentConfig.form.source;
    const fields = (currentConfig.form && currentConfig.form.fields) || [];

    const sourceToggleHtml = `
      <div class="section">
        <div class="toggle-stack">
          <div class="toggle-row rich">
            <div class="toggle-row-text">
              <div class="toggle-label">Pull fields from GHL</div>
              <div class="toggle-desc">Renders the standard booking fields plus every contact custom field on this location. Turn off to design a fully custom form.</div>
            </div>
            <div class="toggle ${source === 'calendar' ? 'on' : ''}" data-form-source-toggle></div>
          </div>
        </div>
      </div>
    `;

    if (source === 'calendar') {
      body.innerHTML = `
        ${sectionHeader('Booking form', 'Fields collected on the final step')}
        ${sourceToggleHtml}
        <div class="section">
          <div class="form-source-note">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.5v3.5M8 5.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <div>
              <div class="form-source-note-title">Fields load from GHL at render time</div>
              <div class="form-source-note-body">GHL's API doesn't expose which fields a specific calendar form uses, so we render the standard booking fields (name, email, phone) plus every contact custom field on the location. Flip the toggle off to hand-pick fields instead.</div>
            </div>
          </div>
        </div>
      `;

      const srcToggle = body.querySelector('[data-form-source-toggle]');
      if (srcToggle) srcToggle.onclick = () => toggleFormSource();
      return;
    }

    // Custom mode — render the field editor as before.
    const itemsHtml = fields.map((f, i) => {
      const isEditing = editingFieldIndex === i;
      if (isEditing) return renderFormFieldEditor(f, i);
      return `
        <div class="form-field-item" data-idx="${i}">
          <span class="form-field-grip">${gripIconSvg()}</span>
          <div class="field-info">
            <div class="field-name">${escHtml(f.label || f.name)}${f.required ? ' <span class="field-req" title="Required">*</span>' : ''}</div>
            <div class="field-type">${f.type || 'text'} · ${escHtml(f.name)}</div>
          </div>
          <div class="field-actions">
            <button class="icon-btn" data-form-move="${i}" data-dir="-1" aria-label="Move up" title="Move up">${arrowUpSvg()}</button>
            <button class="icon-btn" data-form-move="${i}" data-dir="1" aria-label="Move down" title="Move down">${arrowDownSvg()}</button>
            <button class="icon-btn" data-form-edit="${i}" aria-label="Edit" title="Edit">${pencilIconSvg()}</button>
            <button class="icon-btn danger" data-form-remove="${i}" aria-label="Remove" title="Remove">${trashIconSvg()}</button>
          </div>
        </div>
      `;
    }).join('');

    const addingHtml = addingFormField ? renderFormFieldEditor({ name: '', label: '', type: 'text', required: false, placeholder: '' }, -1) : '';

    body.innerHTML = `
      ${sectionHeader('Booking form', 'Fields collected on the final step')}
      ${sourceToggleHtml}
      <div class="section">
        <div class="form-fields-list">${itemsHtml || '<div class="form-empty">No fields yet. Add one below.</div>'}</div>
        ${addingHtml}
        ${!addingFormField ? '<button class="add-field-btn" data-form-add type="button">+ Add field</button>' : ''}
      </div>
    `;

    const srcToggle = body.querySelector('[data-form-source-toggle]');
    if (srcToggle) srcToggle.onclick = () => toggleFormSource();
    body.querySelectorAll('[data-form-add]').forEach(b => b.onclick = () => { addingFormField = true; renderEditor(); });
    body.querySelectorAll('[data-form-edit]').forEach(b => b.onclick = e => { editingFieldIndex = parseInt(e.currentTarget.dataset.formEdit); addingFormField = false; renderEditor(); });
    body.querySelectorAll('[data-form-remove]').forEach(b => b.onclick = e => removeFormField(parseInt(e.currentTarget.dataset.formRemove)));
    body.querySelectorAll('[data-form-move]').forEach(b => b.onclick = e => {
      const el = e.currentTarget;
      moveFormField(parseInt(el.dataset.formMove), parseInt(el.dataset.dir));
    });

    wireFormFieldEditor(body);
  }

  function toggleFormSource() {
    if (!currentConfig.form) currentConfig.form = {};
    currentConfig.form.source = currentConfig.form.source === 'calendar' ? 'custom' : 'calendar';
    editingFieldIndex = -1;
    addingFormField = false;
    updatePreview();
    renderEditor();
  }

  function renderFormFieldEditor(f, idx) {
    const types = ['text', 'email', 'tel', 'textarea', 'number', 'select'];
    const isNew = idx === -1;
    return `
      <div class="form-field-editor" data-editor-idx="${idx}">
        <div class="form-field-editor-head">
          <div class="form-field-editor-title">${isNew ? 'New field' : 'Edit field'}</div>
        </div>
        <div class="field">
          <label>Label</label>
          <input type="text" data-field-prop="label" value="${escHtml(f.label || '')}" placeholder="e.g. Company">
        </div>
        <div class="field-grid">
          <div class="field">
            <label>Key</label>
            <input type="text" data-field-prop="name" value="${escHtml(f.name || '')}" placeholder="company">
          </div>
          <div class="field">
            <label>Type</label>
            <div class="select-wrap">
              <select data-field-prop="type">
                ${types.map(t => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Placeholder</label>
          <input type="text" data-field-prop="placeholder" value="${escHtml(f.placeholder || '')}">
        </div>
        <div class="toggle-row compact">
          <span class="toggle-label">Required</span>
          <div class="toggle ${f.required ? 'on' : ''}" data-field-prop="required"></div>
        </div>
        <div class="form-field-editor-actions">
          <button class="btn btn-ghost" data-field-cancel type="button">Cancel</button>
          <button class="btn btn-primary" data-field-save type="button">${isNew ? 'Add field' : 'Save'}</button>
        </div>
      </div>
    `;
  }

  function wireFormFieldEditor(body) {
    const editor = body.querySelector('.form-field-editor');
    if (!editor) return;
    const idx = parseInt(editor.dataset.editorIdx);
    const isNew = idx === -1;

    const toggleEl = editor.querySelector('.toggle[data-field-prop="required"]');
    if (toggleEl) toggleEl.onclick = () => toggleEl.classList.toggle('on');

    editor.querySelector('[data-field-cancel]').onclick = () => {
      addingFormField = false;
      editingFieldIndex = -1;
      renderEditor();
    };

    editor.querySelector('[data-field-save]').onclick = () => {
      const label = editor.querySelector('[data-field-prop="label"]').value.trim();
      let name = editor.querySelector('[data-field-prop="name"]').value.trim();
      const type = editor.querySelector('[data-field-prop="type"]').value;
      const placeholder = editor.querySelector('[data-field-prop="placeholder"]').value;
      const required = editor.querySelector('[data-field-prop="required"]').classList.contains('on');

      if (!label && !name) { showToast('Label or key required', 'err'); return; }
      if (!name) name = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (!name) { showToast('Invalid field key', 'err'); return; }

      if (!currentConfig.form) currentConfig.form = { fields: [] };
      if (!Array.isArray(currentConfig.form.fields)) currentConfig.form.fields = [];

      const field = { name, label: label || name, type, required, placeholder };
      if (isNew) currentConfig.form.fields.push(field);
      else currentConfig.form.fields[idx] = field;

      addingFormField = false;
      editingFieldIndex = -1;
      renderEditor();
      updatePreview();
    };
  }

  function removeFormField(index) {
    if (!currentConfig.form?.fields) return;
    currentConfig.form.fields.splice(index, 1);
    editingFieldIndex = -1;
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
    const toggles = [
      ['showHeader',      'Show header',            'Title bar at the top of the widget',            comp.showHeader !== false],
      ['showProgressBar', 'Show progress bar',      'Visual step indicator',                          comp.showProgressBar !== false],
      ['showTimezone',    'Show timezone selector', 'Lets guests confirm or change their timezone',   comp.showTimezone !== false],
      ['showPoweredBy',   'Show "Powered by"',      'Small attribution line at the bottom',           comp.showPoweredBy !== false],
    ];

    body.innerHTML = `
      ${sectionHeader('Visibility', 'Toggle chrome and supplementary UI')}
      <div class="section">
        <div class="toggle-stack">
          ${toggles.map(([k, l, d, on]) => `
            <div class="toggle-row rich">
              <div class="toggle-row-text">
                <div class="toggle-label">${l}</div>
                <div class="toggle-desc">${d}</div>
              </div>
              <div class="toggle ${on ? 'on' : ''}" data-toggle="${k}"></div>
            </div>
          `).join('')}
        </div>
      </div>
      ${sectionHeader('Copy', 'Customer-facing text strings')}
      <div class="section">
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
    const current = a.stepTransition || 'slide-left';
    const transOptions = [
      { id: 'slide-left', label: 'Slide', desc: 'Steps slide in horizontally', icon: motionIcon('slide') },
      { id: 'fade',       label: 'Fade',  desc: 'Smooth opacity fade',         icon: motionIcon('fade') },
      { id: 'none',       label: 'None',  desc: 'Instant transitions',         icon: motionIcon('none') },
    ];

    body.innerHTML = `
      ${sectionHeader('Timing', 'How quickly elements respond to interaction')}
      <div class="section">
        <div class="field">
          <label>Transition speed</label>
          <div class="slider-row">
            <input type="range" id="ed-transSpeed" min="0" max="1" step="0.05" value="${parseFloat(a.transitionSpeed) || 0.2}">
            <span class="slider-val">${parseFloat(a.transitionSpeed) || 0.2}s</span>
          </div>
        </div>
      </div>

      ${sectionHeader('Step transition', 'Animation between booking steps')}
      <div class="section">
        <div class="option-cards option-cards-visual">
          ${transOptions.map(opt => `
            <button class="option-card visual ${opt.id === current ? 'active' : ''}" data-step-trans="${opt.id}" type="button">
              <div class="option-visual">${opt.icon}</div>
              <div class="option-text">
                <div class="option-card-label">${opt.label}</div>
                <div class="option-card-sub">${opt.desc}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>

      ${sectionHeader('Interactions', 'Micro-effects')}
      <div class="section">
        <div class="toggle-row rich">
          <div class="toggle-row-text">
            <div class="toggle-label">Hover scale</div>
            <div class="toggle-desc">Slightly grow slots and buttons on hover</div>
          </div>
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

    body.querySelectorAll('[data-step-trans]').forEach(card => {
      card.onclick = () => {
        if (!currentConfig.animations) currentConfig.animations = {};
        currentConfig.animations.stepTransition = card.dataset.stepTrans;
        body.querySelectorAll('[data-step-trans]').forEach(c => c.classList.toggle('active', c === card));
        updatePreview();
      };
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
      ${sectionHeader('Custom CSS', 'Advanced overrides applied on top of the theme')}
      <div class="section">
        <div class="field">
          <textarea class="code-input" id="ed-customCss" rows="16" spellcheck="false" placeholder="/* Override any styles here */&#10;.ct-slot { ... }">${escHtml(currentConfig.customCss || '')}</textarea>
        </div>
        <div class="panel-hint">Tip: target <code>.ct-slot</code>, <code>.ct-cal-day</code>, <code>.ct-btn</code>, or any theme variables like <code>--ct-primary</code>.</div>
      </div>
    `;
    body.querySelector('#ed-customCss').addEventListener('input', (e) => {
      currentConfig.customCss = e.target.value;
      updatePreview();
    });
  }

  // ── Reusable UI helpers ──────────────────────────────────────────────────

  function sectionHeader(title, sub) {
    return `
      <div class="section-header">
        <div class="section-title">${escHtml(title)}</div>
        ${sub ? `<div class="section-sub">${escHtml(sub)}</div>` : ''}
      </div>
    `;
  }

  function checkIconSvg() {
    return '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function gripIconSvg() {
    return '<svg viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4" r="1.1" fill="currentColor"/><circle cx="10" cy="4" r="1.1" fill="currentColor"/><circle cx="6" cy="8" r="1.1" fill="currentColor"/><circle cx="10" cy="8" r="1.1" fill="currentColor"/><circle cx="6" cy="12" r="1.1" fill="currentColor"/><circle cx="10" cy="12" r="1.1" fill="currentColor"/></svg>';
  }
  function arrowUpSvg() {
    return '<svg viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function arrowDownSvg() {
    return '<svg viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function pencilIconSvg() {
    return '<svg viewBox="0 0 16 16" fill="none"><path d="M10.5 2.5l3 3-8 8H2.5v-3l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 4l3 3" stroke="currentColor" stroke-width="1.4"/></svg>';
  }
  function trashIconSvg() {
    return '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5A.5.5 0 016.5 2h3a.5.5 0 01.5.5V4M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  }

  function layoutIcon(kind) {
    if (kind === 'multi') {
      return `<svg viewBox="0 0 56 36" fill="none">
        <rect x="1.5" y="1.5" width="53" height="33" rx="4" stroke="currentColor" stroke-width="1.2" opacity=".4"/>
        <rect x="6" y="7" width="44" height="3" rx="1.5" fill="currentColor" opacity=".4"/>
        <rect x="6" y="7" width="15" height="3" rx="1.5" fill="currentColor"/>
        <rect x="6" y="16" width="20" height="14" rx="2" fill="currentColor" opacity=".18"/>
        <rect x="30" y="16" width="20" height="14" rx="2" fill="currentColor" opacity=".5"/>
      </svg>`;
    }
    if (kind === 'single') {
      return `<svg viewBox="0 0 56 36" fill="none">
        <rect x="1.5" y="1.5" width="53" height="33" rx="4" stroke="currentColor" stroke-width="1.2" opacity=".4"/>
        <rect x="6" y="6" width="44" height="4" rx="1" fill="currentColor"/>
        <rect x="6" y="12" width="44" height="8" rx="1" fill="currentColor" opacity=".28"/>
        <rect x="6" y="22" width="30" height="4" rx="1" fill="currentColor" opacity=".5"/>
        <rect x="40" y="22" width="10" height="4" rx="1" fill="currentColor"/>
      </svg>`;
    }
    // sidebar
    return `<svg viewBox="0 0 56 36" fill="none">
      <rect x="1.5" y="1.5" width="53" height="33" rx="4" stroke="currentColor" stroke-width="1.2" opacity=".4"/>
      <rect x="6" y="6" width="20" height="24" rx="2" fill="currentColor" opacity=".5"/>
      <rect x="30" y="6" width="20" height="6" rx="1" fill="currentColor" opacity=".3"/>
      <rect x="30" y="14" width="20" height="6" rx="1" fill="currentColor" opacity=".3"/>
      <rect x="30" y="22" width="20" height="8" rx="1" fill="currentColor"/>
    </svg>`;
  }

  function slotIcon(kind) {
    if (kind === 'pills') {
      return `<svg viewBox="0 0 56 36" fill="none">
        <rect x="4" y="10" width="14" height="6" rx="3" fill="currentColor" opacity=".35"/>
        <rect x="21" y="10" width="14" height="6" rx="3" fill="currentColor"/>
        <rect x="38" y="10" width="14" height="6" rx="3" fill="currentColor" opacity=".35"/>
        <rect x="4" y="22" width="14" height="6" rx="3" fill="currentColor" opacity=".35"/>
        <rect x="21" y="22" width="14" height="6" rx="3" fill="currentColor" opacity=".35"/>
        <rect x="38" y="22" width="14" height="6" rx="3" fill="currentColor" opacity=".35"/>
      </svg>`;
    }
    if (kind === 'list') {
      return `<svg viewBox="0 0 56 36" fill="none">
        <rect x="4" y="6" width="48" height="6" rx="1.5" fill="currentColor" opacity=".35"/>
        <rect x="4" y="15" width="48" height="6" rx="1.5" fill="currentColor"/>
        <rect x="4" y="24" width="48" height="6" rx="1.5" fill="currentColor" opacity=".35"/>
      </svg>`;
    }
    // grid
    return `<svg viewBox="0 0 56 36" fill="none">
      <rect x="4" y="6" width="14" height="10" rx="1.5" fill="currentColor" opacity=".35"/>
      <rect x="21" y="6" width="14" height="10" rx="1.5" fill="currentColor"/>
      <rect x="38" y="6" width="14" height="10" rx="1.5" fill="currentColor" opacity=".35"/>
      <rect x="4" y="20" width="14" height="10" rx="1.5" fill="currentColor" opacity=".35"/>
      <rect x="21" y="20" width="14" height="10" rx="1.5" fill="currentColor" opacity=".35"/>
      <rect x="38" y="20" width="14" height="10" rx="1.5" fill="currentColor" opacity=".35"/>
    </svg>`;
  }

  function motionIcon(kind) {
    if (kind === 'slide') {
      return `<svg viewBox="0 0 56 36" fill="none">
        <rect x="4" y="9" width="18" height="18" rx="2" fill="currentColor" opacity=".3"/>
        <rect x="28" y="9" width="24" height="18" rx="2" fill="currentColor"/>
        <path d="M17 18h10M23 15l4 3-4 3" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }
    if (kind === 'fade') {
      return `<svg viewBox="0 0 56 36" fill="none">
        <defs><linearGradient id="fg1" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".15"/><stop offset="1" stop-color="currentColor" stop-opacity="1"/></linearGradient></defs>
        <rect x="6" y="9" width="44" height="18" rx="2" fill="url(#fg1)"/>
      </svg>`;
    }
    return `<svg viewBox="0 0 56 36" fill="none">
      <rect x="6" y="9" width="44" height="18" rx="2" fill="currentColor" opacity=".55"/>
      <path d="M14 13l28 10M42 13L14 23" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`;
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
    const searchInput = $('#search-input');
    const searchField = $('#search-field');
    const searchClear = $('#search-clear');
    const syncSearchUI = () => {
      const hasValue = !!searchInput.value;
      searchField.classList.toggle('has-value', hasValue);
      searchClear.hidden = !hasValue;
    };
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      syncSearchUI();
      renderGallery();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        searchQuery = '';
        syncSearchUI();
        renderGallery();
      }
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      syncSearchUI();
      renderGallery();
      searchInput.focus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      const gallery = document.getElementById('view-gallery');
      if (!gallery || gallery.hasAttribute('hidden')) return;
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
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
