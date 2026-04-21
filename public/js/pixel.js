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
  const PIXEL = (window.__calthemePixel = { version: '1.1.0' });

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
  const CACHE_KEY = '__ct_resolved_v1';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const SKELETON_FADE_MS = 350;

  // ─── State ─────────────────────────────────────────────────────────────
  // resolved[calendarId] = { locationId, primaryColor } | null   (null = unthemed)
  const resolved = new Map();
  const pending = new Map(); // calendarId -> Set<Element>
  let flushTimer = null;

  hydrateCache();

  function hydrateCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const now = Date.now();
      for (const id in obj) {
        const entry = obj[id];
        if (!entry || (now - (entry.ts || 0)) > CACHE_TTL_MS) continue;
        if (entry.unthemed) {
          resolved.set(id, null);
        } else if (entry.locationId) {
          resolved.set(id, {
            locationId: entry.locationId,
            primaryColor: entry.primaryColor || '#6C63FF',
          });
        }
      }
    } catch (_) { /* ignore */ }
  }

  function persistCache() {
    try {
      const out = {};
      const now = Date.now();
      resolved.forEach((v, id) => {
        if (v === null) out[id] = { unthemed: true, ts: now };
        else out[id] = { locationId: v.locationId, primaryColor: v.primaryColor, ts: now };
      });
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(out));
    } catch (_) { /* ignore */ }
  }

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
  // id="<something>-<calendarId>", etc. We collect every attribute whose
  // value looks like a 24-hex Mongo ObjectId since that's what GHL issues.
  const MONGO_ID_RE = /[a-f0-9]{20,32}/i;
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
        const m = v.match(MONGO_ID_RE);
        if (m) return m[0];
      }
    }
    return null;
  }

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
  function diagnose() {
    try {
      console.groupCollapsed('[CalTheme Pixel] Diagnostic — no calendar detected');

      const iframes = Array.from(document.querySelectorAll('iframe'));
      console.log('All iframes (' + iframes.length + '):');
      iframes.forEach((f, i) => console.log('  [' + i + ']', f.getAttribute('src'), f));

      const ghlScripts = Array.from(document.querySelectorAll('script[src]'))
        .filter((s) => /msgsndr|leadconnector|gohighlevel|lc-/i.test(s.src));
      console.log('GHL-ish scripts (' + ghlScripts.length + '):');
      ghlScripts.forEach((s) => console.log('  ', s.src));

      const byKeyword = (word) => {
        const re = new RegExp(word, 'i');
        const out = [];
        document.querySelectorAll('*').forEach((el) => {
          if (out.length >= 30) return;
          const id = el.id || '';
          const cls = typeof el.className === 'string' ? el.className : '';
          const attrs = el.getAttributeNames
            ? el.getAttributeNames().filter((n) => n !== 'id' && n !== 'class')
            : [];
          const attrStr = attrs.map((n) => n + '=' + (el.getAttribute(n) || '')).join(' ');
          if (re.test(id) || re.test(cls) || re.test(attrStr)) {
            out.push(el);
          }
        });
        return out;
      };

      const calMatches = byKeyword('calendar');
      console.log('Elements matching /calendar/i (' + calMatches.length + '):');
      calMatches.forEach((el) => console.log('  ', el.tagName.toLowerCase(), el));

      const bookMatches = byKeyword('booking');
      console.log('Elements matching /booking/i (' + bookMatches.length + '):');
      bookMatches.forEach((el) => console.log('  ', el.tagName.toLowerCase(), el));

      const mongoCarriers = [];
      document.querySelectorAll('*').forEach((el) => {
        if (mongoCarriers.length >= 30) return;
        const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
        for (const n of attrs) {
          const v = el.getAttribute(n) || '';
          if (/^[a-f0-9]{20,32}$/i.test(v) || /^[a-f0-9]{20,32}$/i.test(v.split('-').pop())) {
            mongoCarriers.push({ el, attr: n, val: v });
            break;
          }
        }
      });
      console.log('Elements with Mongo-looking IDs (' + mongoCarriers.length + '):');
      mongoCarriers.forEach((x) => console.log('  ', x.attr + '=' + x.val, x.el));

      const customEls = new Set();
      document.querySelectorAll('*').forEach((el) => {
        if (el.tagName.includes('-')) customEls.add(el.tagName.toLowerCase());
      });
      if (customEls.size) console.log('Custom elements:', Array.from(customEls));

      console.log('Tip: share this group with the CalTheme maintainer.');
      console.groupEnd();
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
    persistCache();
  }

  // ─── Apply per element ─────────────────────────────────────────────────
  function apply(id, el) {
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
    if (!iframe.style.minHeight) iframe.style.minHeight = '580px';

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
    if (!div.style.minHeight) div.style.minHeight = '580px';

    const iframe = document.createElement('iframe');
    iframe.dataset.ctSwapped = '1';
    iframe.setAttribute('title', 'Book an appointment');
    iframe.setAttribute('allow', 'payment');
    iframe.style.cssText =
      'width:100%;min-height:580px;border:0;display:block;opacity:0;' +
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
    if (h < 200) return;

    // Match message source to one of our swapped iframes.
    const frames = document.querySelectorAll('iframe[data-ct-swapped="1"]');
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.minHeight = h + 'px';
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
