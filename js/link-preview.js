/**
 * js/link-preview.js
 * ------------------------------------------------------------------
 * Rest the pointer on (or tab to) a link in a post and a small card
 * shows a screenshot of the page it goes to, with its host name. The
 * screenshot comes from microlink's free API (the link's address is
 * sent there; about 50 new screenshots a day per visitor, then "No
 * preview"). Links come from markdown.js: `a.link`. Loads itself.
 * ------------------------------------------------------------------
 */

const OPEN_MS = 450;
const CLOSE_MS = 120;
const failed = new Set();

let card = null;
let anchor = null;
let openTimer = 0;
let closeTimer = 0;

const linkOf = (target) => (target instanceof Element ? target.closest("a.link[href^='https://']") : null);

function shotURL(url) {
  const dark = document.documentElement.dataset.theme === "dark";
  return `https://api.microlink.io/?${new URLSearchParams({
    url,
    screenshot: "true",
    meta: "false",
    embed: "screenshot.url",
    colorScheme: dark ? "dark" : "light",
    "viewport.width": "1280",
    "viewport.height": "800",
    "viewport.deviceScaleFactor": "1",
  })}`;
}

function build() {
  card = document.createElement("div");
  card.className = "link-preview";
  card.setAttribute("aria-hidden", "true");
  card.innerHTML = '<div class="link-preview-shot"><img alt="" width="240" height="150" referrerpolicy="no-referrer" /><span></span></div><p class="link-preview-host"></p>';
  document.body.append(card);
}

/** Above the link, centred on it; below when there is no room; kept on screen. */
function place() {
  const r = (anchor.getClientRects()[0] || anchor.getBoundingClientRect());
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const top = r.top - 8 - h >= 8 ? r.top - 8 - h : r.bottom + 8;
  card.style.top = `${top}px`;
  card.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
}

function show(link) {
  if (!card) build();
  const url = link.href;
  const shot = card.querySelector(".link-preview-shot");
  if (anchor !== link) {
    const img = shot.querySelector("img");
    const label = shot.querySelector("span");
    shot.classList.remove("is-loaded");
    img.onload = () => shot.classList.add("is-loaded");
    img.onerror = () => { failed.add(url); label.textContent = "No preview"; };
    label.textContent = failed.has(url) ? "No preview" : "Loading…";
    if (failed.has(url)) img.removeAttribute("src");
    else img.src = shotURL(url);
    card.querySelector(".link-preview-host").textContent = new URL(url).hostname.replace(/^www\./, "");
  }
  anchor = link;
  place();
  card.classList.add("is-open");
}

function hide() {
  if (card) card.classList.remove("is-open");
}

function enter(e) {
  const link = linkOf(e.target);
  if (!link) return;
  clearTimeout(closeTimer);
  clearTimeout(openTimer);
  openTimer = setTimeout(() => show(link), e.type === "focusin" ? 0 : OPEN_MS);
}

function leave(e) {
  if (!linkOf(e.target)) return;
  clearTimeout(openTimer);
  closeTimer = setTimeout(hide, CLOSE_MS);
}

// Touch has no hover: a tap just follows the link.
if (matchMedia("(hover: hover)").matches) {
  document.addEventListener("mouseover", enter);
  document.addEventListener("mouseout", leave);
}
document.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches(":focus-visible")) enter(e); });
document.addEventListener("focusout", leave);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
addEventListener("scroll", hide, { passive: true, capture: true });
