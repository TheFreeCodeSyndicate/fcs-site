/*
 * js/track.js
 * ------------------------------------------------------------------
 * First-party, cookie-free analytics for the public pages. Sends small
 * beacons to the `collect` Edge Function (supabase/functions/collect):
 *
 *   view    once per page load: path, referring site, utm tags, device
 *           size, timezone (a rough region), and whether this browser
 *           has been here before (a localStorage flag, nothing else)
 *   engage  how long the tab was actually in view, when it is hidden
 *   event   key actions (join links, copy, calendar, subscribe, ...)
 *           and which sections were scrolled to, once each
 *
 * Do Not Track and Global Privacy Control are not applied (Brave and
 * Firefox send them by default, which would hide most phone visitors):
 * nothing personal is stored. Nothing is sent on localhost (add
 * ?track=1 to test locally). The admin panel is never tracked.
 * ------------------------------------------------------------------
 */
(function () {
  const config = window.FCS_CONFIG || {};
  // ?trackdebug=1 shows a small badge saying whether this visit is being
  // counted, and if not, why. For testing from a phone.
  const debug = /[?&]trackdebug=1\b/.test(location.search);
  const note = (text, ok) => {
    if (!debug) return;
    let el = document.getElementById("track-debug");
    if (!el) {
      el = document.createElement("div");
      el.id = "track-debug";
      el.setAttribute("role", "status");
      el.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;padding:10px 12px;border:2px solid #000;font:600 13px/1.4 monospace;color:#000;";
      (document.body || document.documentElement).appendChild(el);
    }
    el.style.background = ok ? "#7be07b" : "#ff8c8c";
    el.textContent = `Analytics: ${text}`;
  };
  if (!config.supabaseUrl) return note("not configured", false);
  if (/^(localhost|127\.)/.test(location.hostname) && !/[?&]track=1\b/.test(location.search)) return note("not counted on localhost", false);

  const endpoint = `${config.supabaseUrl}/functions/v1/collect`;
  const store = (area, key, make) => {
    try {
      let value = window[area].getItem(key);
      if (!value) window[area].setItem(key, (value = make()));
      return value;
    } catch {
      return make();
    }
  };
  const uuid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));

  let isNew = false;
  store("localStorage", "fcs-seen", () => ((isNew = true), new Date().toISOString().slice(0, 10)));
  const session = store("sessionStorage", "fcs-session", uuid);
  const key = uuid();

  // text/plain keeps it a "simple" request: no CORS preflight, and
  // sendBeacon still delivers it while the page is closing.
  const send = (data) => {
    const body = new Blob([JSON.stringify({ ...data, session })], { type: "text/plain" });
    if (debug) {
      // Debug visits use fetch, so the answer (or the block) can be shown.
      fetch(endpoint, { method: "POST", body, keepalive: true, mode: "cors" })
        .then((r) => note(r.status === 204 ? `counting this visit (last: ${data.type}, ${new Date().toLocaleTimeString()})` : `the collector answered ${r.status}`, r.status === 204))
        .catch(() => note("BLOCKED: something on this phone (an ad or tracker blocker, a VPN filter, or the browser's shields) stopped the request", false));
      return;
    }
    if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, body))) {
      fetch(endpoint, { method: "POST", body, keepalive: true, mode: "cors" }).catch(() => {});
    }
  };

  const params = new URLSearchParams(location.search);
  let ref = "";
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    ref = host && host !== location.hostname ? host.replace(/^www\./, "") : "";
  } catch {
    /* no usable referrer */
  }
  const width = window.innerWidth;
  send({
    type: "view",
    key,
    path: location.pathname,
    ref,
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    is_new: isNew,
    device: width < 768 ? "mobile" : width < 1100 ? "tablet" : "desktop",
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "").slice(0, 60),
  });

  // Time actually in view: counted only while the tab is visible, sent
  // (as the running total) each time it is hidden or closed.
  let shownAt = document.visibilityState === "visible" ? performance.now() : null;
  let engaged = 0;
  let lastSent = -1;
  const total = () => engaged + (shownAt != null ? performance.now() - shownAt : 0);
  const report = () => {
    const ms = Math.round(total());
    if (ms !== lastSent) send({ type: "engage", key, ms });
    lastSent = ms;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      engaged = total();
      shownAt = null;
      report();
    } else {
      shownAt = performance.now();
    }
  });
  window.addEventListener("pagehide", report);
  // A beacon sent while a page closes is sometimes lost, so the running
  // total also goes out every 30 seconds while the tab is visible.
  // ponytail: ~2 requests a minute per open tab; fine for a club's traffic
  // on the free tier, raise the interval if invocations ever get close.
  setInterval(() => document.visibilityState === "visible" && report(), 30000);

  const event = (name, label = "") => send({ type: "event", name, label: String(label).trim().slice(0, 80), path: location.pathname });
  window.fcsTrack = event;

  // Key actions, by what was clicked.
  const RULES = [
    [".join-url", "join", (el) => (el.closest(".join-card")?.querySelector(".join-command")?.textContent || "").replace(/^\s*\$\s*join\s*--/, "")],
    [".join-copy", "copy", (el) => el.dataset.copy || el.textContent],
    ["#footer-socials a", "social", (el) => el.getAttribute("aria-label")],
    ["#cal-menu a, #cal-menu button, [data-ics-single]", "calendar", (el) => el.id || "event"],
    ["[data-notify]", "notify", (el) => el.dataset.notify],
    [".repo-card", "repo", (el) => el.querySelector(".repo-name")?.textContent],
    [".resource-card", "resource", (el) => el.querySelector("h3")?.textContent],
    [".core-links a", "member-link", (el) => el.getAttribute("aria-label")],
    ["a.site-link", "link", (el) => el.textContent],
  ];
  document.addEventListener("click", (e) => {
    for (const [selector, name, label] of RULES) {
      const el = e.target.closest && e.target.closest(selector);
      if (el) return event(name, label(el) || "");
    }
  }, true);

  // Sections read: each counted once per page view, once it has sat in
  // the middle fifth of the screen for a second, so a smooth scroll that
  // only passes through a section (a nav jump) does not count it.
  if ("IntersectionObserver" in window) {
    const timers = new Map();
    const watch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.id;
        if (entry.isIntersecting) {
          timers.set(id, setTimeout(() => {
            event("section", id);
            watch.unobserve(entry.target);
          }, 1000));
        } else {
          clearTimeout(timers.get(id));
        }
      }
    }, { rootMargin: "-40% 0px -40% 0px" });
    const start = () => document.querySelectorAll("main section[id]").forEach((s) => watch.observe(s));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
