/**
 * CalTheme Universal Pixel
 *
 * Paste once in a GHL funnel's header tracking code:
 *   <script src="https://<app-origin>/pixel.js" async></script>
 *
 * On load (and on DOM mutations), scan for GHL calendar embeds on the page
 * and replace each themed one with its CalTheme-rendered version. Calendars
 * with no theme assigned are left untouched.
 *
 * Theme resolution is by calendar_id alone (globally unique in our DB), so
 * the snippet is identical for every user — no tenant configuration.
 */
(function () {
  'use strict';

  // Verbose logging — opt-out with ?ctpixel=silent on the script src, or
  // set window.__ctPixelSilent = true before the script loads.
  const LOG_PREFIX = '[CalTheme Pixel]';
  function log() {
    if (window.__ctPixelSilent) return;
    try { console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (_) {}
  }
  function warn() {
    if (window.__ctPixelSilent) return;
    try { console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (_) {}
  }

  if (window.__calthemePixel) {
    log('already loaded, skipping');
    return;
  }
  const PIXEL = (window.__calthemePixel = { version: '1.2.0' });
  PIXEL.network = []; // every URL we see
  PIXEL.foundIds = new Set(); // distinct Mongo IDs we've seen anywhere

  // ─── APP_BASE derivation ────────────────────────────────────────────────
  const scriptEl =
    document.currentScript ||
    Array.from(document.getElementsByTagName('script')).find(
      (s) => s.src && /\/pixel\.js(\?|$)/.test(s.src)
    );
  if (!scriptEl || !scriptEl.src) {
    warn('could not locate own <script> tag — aborting');
    return;
  }
  let APP_BASE;
  try {
    APP_BASE = new URL(scriptEl.src).origin;
  } catch (_) {
    warn('invalid script src — aborting');
    return;
  }
  PIXEL.base = APP_BASE;

  log('booting v' + PIXEL.version, { base: APP_BASE, host: location.hostname, href: location.href });

  // ─── Pre-hide GHL calendar containers (first thing we do) ──────────────
  // Without this, the stock GHL calendar paints before our pixel resolves
  // and swaps — the visitor sees a flash of the wrong calendar. We inject
  // a style that makes known calendar hosts invisible from the moment the
  // pixel is parsed. Layout is preserved (visibility: hidden, not display)
  // so GHL's Vue bundle still mounts, fetches calendar data, and triggers
  // our network interception. We lift the hide once we've decided:
  //   • themed   → swap inline, container becomes visible with our iframe
  //   • unthemed → remove the style, GHL's stock calendar reveals
  //   • no decision within 5s → safety timeout removes the style anyway
  const PRE_HIDE_STYLE_ID = '__ct-pixel-pre-hide';
  const PRE_HIDE_SELECTORS = [
    '#calendarAppointmentBookingMain',
    '#appointment_widgets--revamp',
    '.c-calendar.c-wrapper',
    'div[id^="calendar-kl-"]',
    'div[class*="booking-calendar-"]',
  ];

  function injectPreHideStyle() {
    if (document.getElementById(PRE_HIDE_STYLE_ID)) return;
    try {
      const style = document.createElement('style');
      style.id = PRE_HIDE_STYLE_ID;
      // display:none collapses the container entirely — zero gap, zero
      // reserved space, no loading indicator. Vue's mount/fetch lifecycle
      // still fires on display:none nodes, so our network tap can still
      // capture the calendar_id. On decision we either:
      //   • unthemed → remove this style, GHL renders as normal
      //   • themed   → override inline with display:block and inject
      //                our themed iframe
      style.textContent =
        PRE_HIDE_SELECTORS.join(',') + '{display:none!important}';
      (document.head || document.documentElement).appendChild(style);
      log('pre-hide style injected (display:none)');
    } catch (_) {}
  }

  function removePreHideStyle(reason) {
    const el = document.getElementById(PRE_HIDE_STYLE_ID);
    if (!el) return;
    el.remove();
    log('pre-hide style removed', reason || '');
  }

  injectPreHideStyle();
  // Safety net: if resolve never fires or nothing matches, reveal after 5s
  // so we never leave a visitor looking at a blank spot on the funnel.
  setTimeout(() => removePreHideStyle('safety timeout'), 5000);

  // ─── Network interception (early, before GHL runtime fires) ─────────────
  // GHL's funnel Calendar element doesn't use an iframe — it renders
  // inline via a Vue bundle that calls backend.leadconnectorhq.com or
  // similar, embedding the real calendar_id in the request URL. We tap
  // fetch + XHR to capture any ID that flies by.
  //
  // GHL has at least two calendar-id formats in the wild:
  //   • 24-char lowercase hex Mongo ObjectId (old)       65daa0f0810c87189e37bb6b
  //   • ~20-char mixed-case base62 nanoid-style (new)   V5uQ5Pe35AmkPb5dLfYW
  //
  // We match both by extracting 18..26-char alphanumeric substrings and
  // keeping the ones that look like either format.
  const CANDIDATE_ID_RE = /[A-Za-z0-9]{18,26}/g;
  const GHL_BACKEND_RE = /(leadconnectorhq|msgsndr|gohighlevel)\.com/i;

  function looksLikeGhlId(s) {
    if (!s) return false;
    const n = s.length;
    if (n < 18 || n > 26) return false;
    // Must contain at least one digit — rules out all-letter hash garbage.
    if (!/\d/.test(s)) return false;
    const isMongo = n === 24 && /^[a-f0-9]{24}$/i.test(s);
    const hasUpper = /[A-Z]/.test(s);
    // Either a real Mongo ObjectId, or mixed-case (GHL's new nanoid style).
    return isMongo || hasUpper;
  }

  function extractIds(str) {
    if (!str || typeof str !== 'string') return [];
    const raw = str.match(CANDIDATE_ID_RE) || [];
    const seen = new Set();
    const out = [];
    raw.forEach((s) => {
      if (seen.has(s)) return;
      seen.add(s);
      if (looksLikeGhlId(s)) out.push(s);
    });
    return out;
  }

  function recordId(id, source) {
    if (!id || PIXEL.foundIds.has(id)) return;
    PIXEL.foundIds.add(id);
    log('captured Mongo ID', { id, source });
    onCalendarIdDiscovered(id);
  }

  function inspectUrl(url) {
    if (!url || typeof url !== 'string') return;
    try {
      PIXEL.network.push(url);
      if (PIXEL.network.length > 200) PIXEL.network.shift();
      if (!GHL_BACKEND_RE.test(url)) return;
      extractIds(url).forEach((id) => recordId(id, url));
    } catch (_) {}
  }

  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input && input.url;
        inspectUrl(url);
        return origFetch.apply(this, arguments);
      };
    }
  } catch (_) {}

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      inspectUrl(url);
      return origOpen.apply(this, arguments);
    };
  } catch (_) {}

  // Our <script async> races with GHL's calendar bundle. If GHL's fetch
  // fires before we patch, we can still see it in resource timing.
  function scanPerformanceResources() {
    try {
      const entries = performance.getEntriesByType
        ? performance.getEntriesByType('resource')
        : [];
      entries.forEach((e) => inspectUrl(e.name));
    } catch (_) {}
  }
  scanPerformanceResources();
  setInterval(scanPerformanceResources, 1500);

  // Vue component introspection — once GHL's Vue bundle mounts the
  // calendar, the calendar_id typically lives on the component props.
  function scanVueInstance() {
    try {
      const hosts = document.querySelectorAll(
        '#calendarAppointmentBookingMain, #appointment_widgets--revamp, .c-calendar, div[id^="calendar-kl-"]'
      );
      hosts.forEach((el) => {
        const vc =
          el.__vueParentComponent ||
          el.__vue_app__ ||
          el.__vue__ ||
          (el.childNodes[0] && el.childNodes[0].__vueParentComponent);
        if (!vc) return;
        const cand = [
          vc.props,
          vc.attrs,
          vc.ctx,
          vc.proxy && vc.proxy.$data,
          vc.proxy && vc.proxy.$props,
          vc.$props,
          vc.$data,
          vc.$options && vc.$options.propsData,
        ];
        cand.forEach((obj) => {
          if (!obj) return;
          try {
            const s = JSON.stringify(obj, (k, v) => (typeof v === 'function' ? undefined : v));
            extractIds(s).forEach((id) => recordId(id, 'vue-state'));
          } catch (_) {}
        });
      });
    } catch (_) {}
  }
  setInterval(scanVueInstance, 1500);

  // ─── Editor guard (narrow) ──────────────────────────────────────────────
  // Only skip inside the GHL builder app itself. Many published GHL funnels
  // live on *.gohighlevel.com subdomains, so we MUST NOT bail on those.
  const host = (location.hostname || '').toLowerCase();
  const isBuilder =
    host === 'app.gohighlevel.com' ||
    host === 'app.msgsndr.com' ||
    host === 'marketplace.gohighlevel.com';
  if (isBuilder) {
    log('running on GHL builder host (' + host + ') — skipping mutations');
    PIXEL.skipped = 'builder-host';
    return;
  }

  // ─── Constants ─────────────────────────────────────────────────────────
  const GHL_HOST_RE =
    /^https?:\/\/([^/?#]*\.leadconnectorhq\.com|[^/?#]*\.msgsndr\.com)/i;
  const BOOKING_PATH = '/widget/booking/';
  const FLUSH_DEBOUNCE_MS = 150;
  const SKELETON_FADE_MS = 350;

  // ─── State ─────────────────────────────────────────────────────────────
  // resolved[calendarId] = { locationId, primaryColor } | null   (null = unthemed)
  // No sessionStorage cache — we want every page load to reflect the
  // current assignment. If a user unassigns a theme, the next load must
  // leave the page exactly as GHL rendered it, not pick up a stale
  // "themed" entry and swap.
  const resolved = new Map();
  const pending = new Map(); // calendarId -> Set<Element>
  let flushTimer = null;

  // ─── Detection ─────────────────────────────────────────────────────────
  function calendarIdFromIframe(iframe) {
    const src = iframe.getAttribute('src') || '';
    if (!GHL_HOST_RE.test(src) || src.indexOf(BOOKING_PATH) === -1) return null;
    try {
      const u = new URL(src, location.href);
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || null;
    } catch (_) {
      return null;
    }
  }

  // Pull a calendar ID out of whatever attribute GHL happens to use. Over
  // the years: data-calendar, data-calendar-id, data-widget-id, data-id,
  // id="<something>-<calendarId>", etc. Supports both the old 24-char hex
  // Mongo ObjectId format and the newer ~20-char base62 nanoid.
  function calendarIdFromElement(el) {
    const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
    for (const name of attrs) {
      const lname = name.toLowerCase();
      if (
        lname === 'data-calendar' ||
        lname === 'data-calendar-id' ||
        lname === 'data-widget-id' ||
        lname === 'data-resource' ||
        lname === 'data-id' ||
        lname === 'data-embed-id' ||
        lname === 'id'
      ) {
        const v = (el.getAttribute(name) || '').trim();
        const ids = extractIds(v);
        if (ids.length) return ids[0];
      }
    }
    return null;
  }

  // Sweep every inline <script> body once after load — GHL sometimes
  // bakes the calendar_id into a window.__INITIAL_STATE__ blob or a
  // static JS const that gets executed before our pixel attaches.
  function scanInlineScripts() {
    try {
      document.querySelectorAll('script:not([src])').forEach((s) => {
        const txt = s.textContent;
        if (!txt || txt.length < 30) return;
        // Only consider payloads that actually mention a calendar keyword,
        // to keep noise down.
        if (!/calendar|appointment|booking/i.test(txt)) return;
        extractIds(txt).forEach((id) => recordId(id, 'inline-script'));
      });
    } catch (_) {}
  }
  setInterval(scanInlineScripts, 1500);

  function scan(root) {
    root = root || document;
    const rootLabel = root === document ? 'document' : (root.tagName || 'node');
    let matched = 0;
    let iframeSeen = 0;
    let skippedSrcs = [];

    const iframes = root.querySelectorAll ? root.querySelectorAll('iframe[src]') : [];
    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i];
      if (iframe.dataset.ctSwapped || iframe.dataset.ctChecked) continue;
      iframeSeen++;
      const id = calendarIdFromIframe(iframe);
      if (id) {
        matched++;
        log('matched iframe', { id, src: iframe.getAttribute('src') });
        queue(id, iframe);
      } else {
        const src = iframe.getAttribute('src') || '';
        if (src) skippedSrcs.push(src);
      }
    }

    // Broader div-embed detection: any element whose attrs hint at a
    // calendar (class/id/data-* containing "calendar" or "booking").
    const q =
      'div[data-calendar-id], div[data-calendar], div[data-widget-id], ' +
      'div[data-resource], div[data-embed-id], ' +
      'div[id*="calendar" i], div[class*="calendar" i], ' +
      'div[id*="booking" i], div[class*="booking" i]';
    const divs = root.querySelectorAll ? root.querySelectorAll(q) : [];
    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div.dataset.ctPreempted || div.dataset.ctChecked) continue;
      const id = calendarIdFromElement(div);
      if (id) {
        matched++;
        log('matched div-embed', { id, div });
        queue(id, div);
      }
    }

    log('scan complete', {
      root: rootLabel,
      iframesSeen: iframeSeen,
      divsSeen: divs.length,
      matched,
      skippedIframeSrcs: skippedSrcs.slice(0, 8),
    });

    // If the top-level scan still matched nothing, dump a diagnostic so the
    // operator can see exactly what GHL's calendar markup actually looks like
    // on this funnel. Only run once per page.
    if (root === document && matched === 0 && iframeSeen === 0 && !PIXEL._diagnosed) {
      PIXEL._diagnosed = true;
      setTimeout(diagnose, 2500);
    }
  }

  // ─── Diagnostic dump ───────────────────────────────────────────────────
  // All output is printed as plain strings so it can be copy/pasted out of
  // DevTools without losing information (DOM elements don't copy well).
  function describeEl(el) {
    const tag = (el.tagName || '').toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls =
      typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().replace(/\s+/g, '.')
        : '';
    const attrs = (el.getAttributeNames ? el.getAttributeNames() : [])
      .filter((n) => n !== 'id' && n !== 'class' && n !== 'style')
      .map((n) => {
        let v = el.getAttribute(n) || '';
        if (v.length > 80) v = v.slice(0, 80) + '…';
        return n + '="' + v + '"';
      })
      .join(' ');
    return tag + id + cls + (attrs ? ' [' + attrs + ']' : '');
  }

  function diagnose() {
    try {
      console.group('[CalTheme Pixel] Diagnostic dump — copy everything below');

      // 1. All iframes
      const iframes = Array.from(document.querySelectorAll('iframe'));
      console.log('== iframes (' + iframes.length + ') ==');
      iframes.forEach((f, i) =>
        console.log('  [' + i + '] src=' + (f.getAttribute('src') || '(none)'))
      );

      // 2. Scripts pointing at GHL
      const ghlScripts = Array.from(document.querySelectorAll('script[src]'))
        .filter((s) => /msgsndr|leadconnector|gohighlevel|lc-/i.test(s.src));
      console.log('== GHL-ish scripts (' + ghlScripts.length + ') ==');
      ghlScripts.forEach((s) => console.log('  ' + s.src));

      // 3. Every element whose id/class/attrs mention "calendar" or "booking"
      const keywordHits = [];
      const re = /calendar|booking|appointment/i;
      document.querySelectorAll('*').forEach((el) => {
        if (keywordHits.length >= 30) return;
        const id = el.id || '';
        const cls = typeof el.className === 'string' ? el.className : '';
        const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
        const attrStr = attrs.map((n) => n + '=' + (el.getAttribute(n) || '')).join(' ');
        if (re.test(id) || re.test(cls) || re.test(attrStr)) keywordHits.push(el);
      });
      console.log('== elements mentioning /calendar|booking|appointment/ (' + keywordHits.length + ') ==');
      keywordHits.forEach((el, i) => {
        console.log('  [' + i + '] ' + describeEl(el));
      });

      // 3a. First 3 matching elements' full outerHTML (truncated) so we can
      //     see everything inside: data-*, inline JSON, child markup.
      console.log('== outerHTML of first 3 matching elements ==');
      keywordHits.slice(0, 3).forEach((el, i) => {
        let html = el.outerHTML || '';
        if (html.length > 1500) html = html.slice(0, 1500) + '\n…[truncated]';
        console.log('--- [' + i + '] ---\n' + html);
      });

      // 4. Candidate calendar IDs across the page — both Mongo hex and
      //    GHL's newer ~20-char base62 nanoid format.
      const attrHits = new Map();
      document.querySelectorAll('*').forEach((el) => {
        const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
        attrs.forEach((n) => {
          const v = el.getAttribute(n) || '';
          extractIds(v).forEach((id) => attrHits.set(id, n));
        });
      });
      console.log('== candidate IDs in attributes (' + attrHits.size + ') ==');
      attrHits.forEach((attr, id) => console.log('  ' + id + '  (from @' + attr + ')'));

      const scriptHits = new Set();
      document.querySelectorAll('script:not([src])').forEach((s) => {
        const txt = s.textContent || '';
        if (!/calendar|appointment|booking/i.test(txt)) return;
        extractIds(txt).forEach((id) => scriptHits.add(id));
      });
      console.log('== candidate IDs in calendar-mentioning inline scripts (' + scriptHits.size + ') ==');
      scriptHits.forEach((id) => console.log('  ' + id));

      // Fallback: search the whole rendered HTML (one string) for IDs.
      // Noisy but catches anything the specific passes missed.
      try {
        const allHtmlIds = new Set();
        extractIds(document.documentElement.outerHTML).forEach((id) => allHtmlIds.add(id));
        console.log('== candidate IDs across the entire document HTML (' + allHtmlIds.size + ') ==');
        Array.from(allHtmlIds).slice(0, 50).forEach((id) => console.log('  ' + id));
      } catch (_) {}

      // 5. Custom elements (web components)
      const customEls = new Set();
      document.querySelectorAll('*').forEach((el) => {
        if (el.tagName.includes('-')) customEls.add(el.tagName.toLowerCase());
      });
      if (customEls.size) console.log('== custom elements ==\n  ' + Array.from(customEls).join(', '));

      // 6. window.* globals that smell like GHL runtime state
      const hints = [];
      for (const k in window) {
        if (hints.length >= 40) break;
        if (/(ghl|lc|leadconn|msgsndr|calendar|funnel)/i.test(k)) hints.push(k);
      }
      console.log('== suspicious window.* keys ==\n  ' + hints.join(', '));

      // 7. Network activity seen by our interception + resource-timing
      scanPerformanceResources();
      console.log('== URLs observed (' + PIXEL.network.length + ') — GHL-ish only ==');
      PIXEL.network
        .filter((u) => GHL_BACKEND_RE.test(u))
        .slice(-40)
        .forEach((u) => console.log('  ' + u));

      // 8. IDs we already captured
      if (PIXEL.foundIds.size) {
        console.log('== captured Mongo IDs (' + PIXEL.foundIds.size + ') ==');
        PIXEL.foundIds.forEach((id) => console.log('  ' + id));
      } else {
        console.log('== captured Mongo IDs: none yet ==');
      }

      console.groupEnd();
      console.log('[CalTheme Pixel] diagnose() done. Run window.__calthemePixel.diagnose() to re-run.');
    } catch (err) {
      warn('diagnose failed', err);
    }
  }

  // ─── Queue + flush ─────────────────────────────────────────────────────
  function queue(id, el) {
    if (resolved.has(id)) {
      apply(id, el);
      return;
    }
    if (!pending.has(id)) pending.set(id, new Set());
    pending.get(id).add(el);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }

  async function flush() {
    flushTimer = null;
    if (pending.size === 0) return;
    const ids = Array.from(pending.keys());
    log('resolving', ids);

    let data = null;
    try {
      const res = await fetch(APP_BASE + '/api/pixel/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarIds: ids }),
      });
      log('resolve response', { status: res.status, ok: res.ok });
      if (res.ok) data = await res.json();
      else warn('resolve returned non-OK status', res.status);
    } catch (err) {
      warn('resolve fetch failed', err && err.message ? err.message : err);
    }

    const resolvedMap = (data && data.resolved) || {};
    log('resolved map', resolvedMap);

    for (const id of ids) {
      const hit = resolvedMap[id] || null;
      resolved.set(id, hit);
      const set = pending.get(id);
      pending.delete(id);
      if (set) set.forEach((el) => apply(id, el));
    }
  }

  // ─── Apply per element ─────────────────────────────────────────────────
  function apply(id, el) {
    if (el === '__inline__') {
      applyInlineCalendar(id);
      return;
    }
    const hit = resolved.get(id);
    if (!hit) {
      log('no theme for', id, '— leaving untouched');
      try { el.dataset.ctChecked = '1'; } catch (_) {}
      return;
    }
    if (el.tagName === 'IFRAME') {
      log('swapping iframe for', id, hit);
      swapIframe(el, id, hit);
    } else {
      log('preempting div for', id, hit);
      preemptDiv(el, id, hit);
    }
  }

  // ─── Inline-calendar swap (GHL native funnel Calendar element) ─────────
  // GHL's funnel Calendar element renders a full Vue app inline into a
  // host div (no iframe). We replace that host div's children with our
  // themed iframe once we have the real calendar_id (discovered by
  // sniffing GHL's network calls).

  const INLINE_SELECTORS = [
    '#calendarAppointmentBookingMain',
    '#appointment_widgets--revamp',
    '.c-calendar.c-wrapper',
    'div[id^="calendar-kl-"]',
    'div[class*="booking-calendar-"]',
  ];

  function findInlineContainer() {
    for (const sel of INLINE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && !el.dataset.ctSwapped) return el;
    }
    return null;
  }

  function onCalendarIdDiscovered(id) {
    if (resolved.has(id)) {
      applyInlineCalendar(id);
      return;
    }
    if (!pending.has(id)) pending.set(id, new Set());
    pending.get(id).add('__inline__');
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }

  function applyInlineCalendar(id) {
    const hit = resolved.get(id);
    if (!hit) {
      log('inline calendar', id, 'is not themed — revealing GHL original');
      removePreHideStyle('unthemed calendar, reveal original');
      return;
    }
    const container = findInlineContainer();
    if (!container) {
      warn('no inline calendar container found in DOM — cannot swap ' + id);
      // Try again shortly in case GHL's runtime is still mounting. We keep
      // the pre-hide in place during the retry window so the visitor does
      // not see the stock calendar flash through.
      setTimeout(() => {
        const c = findInlineContainer();
        if (c) swapInlineCalendar(id, hit, c);
        else removePreHideStyle('container never found, fall back to original');
      }, 1500);
      return;
    }
    swapInlineCalendar(id, hit, container);
  }

  function swapInlineCalendar(id, hit, container) {
    // Belt-and-suspenders: never mutate the page if the calendar is not
    // themed. Callers already guard on this, but it is critical that an
    // unthemed calendar renders exactly as GHL intended.
    if (!hit || !hit.locationId) {
      log('swap aborted — no theme for', id);
      return;
    }
    if (container.dataset.ctSwapped === '1') return;
    ensureKeyframes();
    container.dataset.ctSwapped = '1';
    log('swapping inline calendar', { id, container });

    // Our iframe will be a child of `container`; the pre-hide rule hides
    // all children via `> *`, so lift it before we inject — our own
    // skeleton + opacity transition will handle the fade.
    removePreHideStyle('themed swap');

    // Clear the Vue-rendered UI and replace with our themed iframe. The
    // container becomes a simple iframe host; Vue's reactive state goes
    // orphaned but that's fine — it won't try to re-mount onto a detached
    // subtree.
    container.innerHTML = '';
    // Reset whatever layout/padding GHL computed onto this host so our
    // iframe dictates the final size. !important beats stylesheet rules
    // that target the container by class. Also force visibility:visible
    // to override the pre-hide style we injected at boot.
    const resetStyle =
      'padding:0 !important;margin:0 !important;min-height:0 !important;' +
      'height:auto !important;max-height:none !important;position:relative;' +
      'display:block !important;width:100%;' +
      'visibility:visible !important;';
    container.setAttribute('style', resetStyle);

    const iframe = document.createElement('iframe');
    iframe.dataset.ctSwapped = '1';
    iframe.setAttribute('title', 'Book an appointment');
    iframe.setAttribute('allow', 'payment');
    // Small initial reserve so we don't collapse to 0 during load — the
    // first ct-embed-height message replaces it with the exact size.
    iframe.style.cssText =
      'width:100%;height:320px;border:0;display:block;opacity:0;' +
      'transition:opacity .35s ease;position:relative;z-index:2;';
    container.appendChild(iframe);

    const skeleton = makeSkeleton(hit.primaryColor);
    container.appendChild(skeleton);

    const onLoad = () => {
      iframe.style.opacity = '1';
      skeleton.style.opacity = '0';
      setTimeout(() => {
        if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
      }, SKELETON_FADE_MS);
      iframe.removeEventListener('load', onLoad);
    };
    iframe.addEventListener('load', onLoad);

    try { iframe.src = themedUrl(id, hit); } catch (_) {}

    // If GHL's runtime re-mounts into the container, evict its injection.
    try {
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => {
            if (n === iframe || n === skeleton) return;
            if (n.nodeType === 1) {
              try { n.remove(); } catch (_) {}
            }
          });
        }
      });
      mo.observe(container, { childList: true });
    } catch (_) {}
  }

  // ─── Iframe swap ───────────────────────────────────────────────────────
  function themedUrl(id, hit) {
    return (
      APP_BASE +
      '/embed/' +
      encodeURIComponent(hit.locationId) +
      '/' +
      encodeURIComponent(id)
    );
  }

  function makeSkeleton(primaryColor) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-ct-skeleton', '1');
    wrap.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:color-mix(in srgb, ' + primaryColor + ' 8%, white);' +
      'transition:opacity .35s ease;pointer-events:none;z-index:1;';
    const ring = document.createElement('div');
    ring.style.cssText =
      'width:32px;height:32px;border-radius:50%;' +
      'border:3px solid color-mix(in srgb, ' + primaryColor + ' 20%, transparent);' +
      'border-top-color:' + primaryColor + ';' +
      'animation:ct-spin .8s linear infinite;';
    wrap.appendChild(ring);
    return wrap;
  }

  // Ensure the keyframes only get injected once per page.
  function ensureKeyframes() {
    if (document.getElementById('__ct-pixel-kf')) return;
    const style = document.createElement('style');
    style.id = '__ct-pixel-kf';
    style.textContent = '@keyframes ct-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  function swapIframe(iframe, id, hit) {
    if (iframe.dataset.ctSwapped === '1') return;
    ensureKeyframes();
    iframe.dataset.ctSwapped = '1';

    iframe.removeAttribute('scrolling');
    const parent = iframe.parentNode;
    if (!parent) return;

    // Wrap iframe in a position:relative container so the skeleton can overlay.
    const wrap = document.createElement('div');
    wrap.setAttribute('data-ct-wrap', '1');
    // Preserve block-level layout; keep iframe's dimensions intact.
    wrap.style.cssText = 'position:relative;display:block;width:100%;';
    parent.insertBefore(wrap, iframe);
    wrap.appendChild(iframe);

    const skeleton = makeSkeleton(hit.primaryColor);
    wrap.appendChild(skeleton);

    iframe.style.transition = 'opacity .35s ease';
    iframe.style.opacity = '0';
    iframe.style.position = 'relative';
    iframe.style.zIndex = '2';
    // Small initial reserve — the first ct-embed-height message replaces
    // this with the exact content height (can shrink as well as grow).
    iframe.style.height = '320px';
    iframe.style.minHeight = '0';

    // Clear the in-flight GHL load, then point at our themed embed on the
    // next tick — this prevents a flash of partially-loaded stock content.
    try { iframe.src = 'about:blank'; } catch (_) {}
    const url = themedUrl(id, hit);

    const onLoad = () => {
      if (iframe.src && iframe.src.indexOf(APP_BASE) !== 0) return;
      iframe.style.opacity = '1';
      skeleton.style.opacity = '0';
      setTimeout(() => {
        if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
      }, SKELETON_FADE_MS);
      iframe.removeEventListener('load', onLoad);
    };
    iframe.addEventListener('load', onLoad);

    setTimeout(() => {
      try { iframe.src = url; } catch (_) {}
    }, 0);

    // Re-injection guard: if GHL scripts rewrite src back to a GHL host,
    // restore our themed URL.
    try {
      const mo = new MutationObserver(() => {
        const current = iframe.getAttribute('src') || '';
        if (GHL_HOST_RE.test(current)) {
          try { iframe.src = url; } catch (_) {}
        }
      });
      mo.observe(iframe, { attributes: true, attributeFilter: ['src'] });
    } catch (_) { /* ignore */ }
  }

  // ─── Div preempt ───────────────────────────────────────────────────────
  function preemptDiv(div, id, hit) {
    if (div.dataset.ctPreempted === '1') return;
    ensureKeyframes();
    div.dataset.ctPreempted = '1';

    // Remove whatever GHL may have already injected (or was about to).
    while (div.firstChild) div.removeChild(div.firstChild);

    div.style.position = div.style.position || 'relative';
    div.style.minHeight = '0';
    div.style.padding = '0';

    const iframe = document.createElement('iframe');
    iframe.dataset.ctSwapped = '1';
    iframe.setAttribute('title', 'Book an appointment');
    iframe.setAttribute('allow', 'payment');
    iframe.style.cssText =
      'width:100%;height:320px;border:0;display:block;opacity:0;' +
      'transition:opacity .35s ease;position:relative;z-index:2;';
    div.appendChild(iframe);

    const skeleton = makeSkeleton(hit.primaryColor);
    div.appendChild(skeleton);

    const url = themedUrl(id, hit);
    const onLoad = () => {
      iframe.style.opacity = '1';
      skeleton.style.opacity = '0';
      setTimeout(() => {
        if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
      }, SKELETON_FADE_MS);
      iframe.removeEventListener('load', onLoad);
    };
    iframe.addEventListener('load', onLoad);
    try { iframe.src = url; } catch (_) {}

    // If GHL's loader still appends a stock iframe into our div, evict it.
    try {
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => {
            if (n === iframe || n === skeleton) return;
            if (n.tagName === 'IFRAME') {
              const s = n.getAttribute('src') || '';
              if (GHL_HOST_RE.test(s)) {
                try { n.remove(); } catch (_) {}
              }
            }
          });
        }
      });
      mo.observe(div, { childList: true });
    } catch (_) { /* ignore */ }
  }

  // ─── Height postMessage from themed embed ──────────────────────────────
  window.addEventListener('message', (e) => {
    if (!e || !e.data) return;
    let h = 0;
    if (typeof e.data === 'object') {
      if (e.data.type === 'ct-embed-height' && typeof e.data.height === 'number') {
        h = e.data.height;
      } else if (typeof e.data.height === 'number') {
        // Fallback: some GHL-origin messages pass { height: N } too — only
        // accept if the source is one of our swapped iframes.
        h = e.data.height;
      }
    } else if (typeof e.data === 'string') {
      const n = parseInt(e.data, 10);
      if (!isNaN(n)) h = n;
    }
    if (h < 120) return;

    // Match message source to one of our swapped iframes and set the exact
    // height — not min-height — so the frame can shrink as well as grow.
    const frames = document.querySelectorAll('iframe[data-ct-swapped="1"]');
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = h + 'px';
        frames[i].style.minHeight = '0';
        break;
      }
    }
  });

  // ─── MutationObserver for late injections ──────────────────────────────
  function startObserver() {
    if (!document.body) {
      warn('document.body missing — cannot start observer yet');
      return;
    }
    try {
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => {
            if (n.nodeType === 1) scan(n);
          });
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      PIXEL.observer = mo;
      log('MutationObserver active on document.body');
    } catch (err) {
      warn('MutationObserver failed', err);
    }
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────
  function boot() {
    log('boot scan starting');
    scan(document);
    startObserver();
    // Funnel builders often stream in content after DOMContentLoaded and
    // after the initial load event. A couple of follow-up scans cover those
    // cases without relying on MutationObserver firing for every subtree.
    setTimeout(() => { log('follow-up scan @1s'); scan(document); }, 1000);
    setTimeout(() => { log('follow-up scan @3s'); scan(document); }, 3000);
    setTimeout(() => { log('follow-up scan @6s'); scan(document); }, 6000);
  }

  // Expose a tiny debug API so we can re-trigger a scan from DevTools:
  //   window.__calthemePixel.scan()  // force another sweep
  //   window.__calthemePixel.resolved   // cached resolutions
  PIXEL.scan = () => scan(document);
  PIXEL.diagnose = diagnose;
  PIXEL.resolved = resolved;
  PIXEL.pending = pending;

  if (document.readyState === 'loading') {
    log('waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    log('document already interactive — booting immediately');
    boot();
  }
})();
