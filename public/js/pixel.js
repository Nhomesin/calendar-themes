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

  if (window.__calthemePixel) return;
  const PIXEL = (window.__calthemePixel = { version: '1.0.0' });

  // ─── APP_BASE derivation ────────────────────────────────────────────────
  const scriptEl =
    document.currentScript ||
    Array.from(document.getElementsByTagName('script')).find(
      (s) => s.src && /\/pixel\.js(\?|$)/.test(s.src)
    );
  if (!scriptEl || !scriptEl.src) return;
  let APP_BASE;
  try {
    APP_BASE = new URL(scriptEl.src).origin;
  } catch (_) {
    return;
  }
  PIXEL.base = APP_BASE;

  // ─── Editor / preview guard ────────────────────────────────────────────
  // Never mutate the GHL builder itself or any internal GHL/LeadConnector
  // domain. Customer-owned funnel domains are everything else.
  const host = location.hostname || '';
  if (
    /(^|\.)gohighlevel\.com$/i.test(host) ||
    /(^|\.)leadconnectorhq\.com$/i.test(host) ||
    /(^|\.)msgsndr\.com$/i.test(host)
  ) {
    return;
  }

  // ─── Constants ─────────────────────────────────────────────────────────
  const GHL_HOST_RE =
    /^https?:\/\/(api\.leadconnectorhq\.com|link\.msgsndr\.com|widgets\.leadconnectorhq\.com|[^/?#]*\.msgsndr\.com)/i;
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

  function scan(root) {
    root = root || document;
    // Iframes
    const iframes = root.querySelectorAll ? root.querySelectorAll('iframe[src]') : [];
    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i];
      if (iframe.dataset.ctSwapped || iframe.dataset.ctChecked) continue;
      const id = calendarIdFromIframe(iframe);
      if (id) queue(id, iframe);
    }
    // Div-embed pattern. Limit to data-calendar(-id) explicitly so we never
    // touch form divs (data-form-id), which share the same loader script.
    const divs = root.querySelectorAll
      ? root.querySelectorAll('div[data-calendar-id], div[data-calendar]')
      : [];
    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div.dataset.ctPreempted || div.dataset.ctChecked) continue;
      const id = (div.dataset.calendarId || div.dataset.calendar || '').trim();
      if (id) queue(id, div);
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
    let data = null;
    try {
      const res = await fetch(APP_BASE + '/api/pixel/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarIds: ids }),
      });
      if (res.ok) data = await res.json();
    } catch (_) { /* offline / blocked — leave everything alone */ }

    const resolvedMap = (data && data.resolved) || {};

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
      try { el.dataset.ctChecked = '1'; } catch (_) {}
      return;
    }
    if (el.tagName === 'IFRAME') swapIframe(el, id, hit);
    else preemptDiv(el, id, hit);
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
    if (!document.body) return;
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
    } catch (_) { /* ignore */ }
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────
  function boot() {
    scan(document);
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
