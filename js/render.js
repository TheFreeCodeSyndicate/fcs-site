/*
 * js/render.js
 * ------------------------------------------------------------------
 * HTML builders shared by the public page (main.js) and the admin
 * panel's live preview (admin.js). One function renders a card in both
 * places, so the preview is exactly what gets published.
 *
 * Everything that takes stored text escapes it. safeURL refuses
 * anything that is not http(s), so a stored javascript: URL cannot run.
 * ------------------------------------------------------------------
 */

/* A pixel icon from the sprite in assets/icons.svg. Decorative: the
 * text beside it (or the control's aria-label) carries the meaning. */
export function icon(name, className = "") {
  return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-${name}"></use></svg>`;
}

/* Social platforms map onto the sprite; anything unknown gets a link. */
export const PLATFORM_ICONS = new Set(["discord", "instagram", "whatsapp", "github", "x"]);

/* Sites we have a pixel icon for, recognised from the link itself, so a
 * LinkedIn link saved as "web" still gets the LinkedIn icon. */
const KNOWN_SITES = [
  [/(^|\.)(discord\.gg|discord\.com|discordapp\.com)$/, "discord"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, "whatsapp"],
  [/(^|\.)(github\.com|github\.io)$/, "github"],
  [/(^|\.)(x\.com|twitter\.com)$/, "x"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
];

function parseLink(url) {
  try {
    return new URL(String(url || "").trim());
  } catch {
    return null;
  }
}

/** The pixel icon for a link's site, or null if we have none. */
export function knownSiteIcon(url) {
  const link = parseLink(url);
  if (!link) return null;
  if (link.protocol === "mailto:") return "mail";
  if (!/^https?:$/.test(link.protocol)) return null;
  const host = link.hostname.toLowerCase();
  const hit = KNOWN_SITES.find(([pattern]) => pattern.test(host));
  return hit ? hit[1] : null;
}

/* Any link's icon, in order: our pixel icon for a known site; otherwise
 * that site's favicon; otherwise `fallback`. The favicon comes from
 * Google's favicon service (only the domain is sent). When it has no
 * icon it answers with a 16px default globe, so watchFavicons() swaps
 * anything that small, or that fails to load, for the fallback.
 * className and fallback are icon names from code, never user input. */
export function linkIcon(url, className = "", fallback = "link") {
  const known = knownSiteIcon(url);
  if (known) return icon(known, className);
  const favicon = faviconURL(url);
  if (!favicon) return icon(fallback, className);
  return `<img class="icon icon-favicon ${className}" src="${favicon}" alt="" width="24" height="24" loading="lazy" referrerpolicy="no-referrer" data-fallback="${fallback}" data-class="${className}" />`;
}

let watching = false;
/** Call once per page. load/error do not bubble, so listen in the capture phase. */
export function watchFavicons() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  const swap = (img) => {
    const t = document.createElement("template");
    t.innerHTML = icon(img.dataset.fallback || "link", img.dataset.class || "");
    img.replaceWith(t.content);
  };
  const check = (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("icon-favicon")) return;
    // ponytail: a site whose only favicon is 16px also falls back; the
    // service gives no other signal that it found nothing.
    if (event.type === "error" || img.naturalWidth <= 16) swap(img);
  };
  document.addEventListener("load", check, true);
  document.addEventListener("error", check, true);
}

/* A named platform keeps its icon; "web", "other" or anything else is
 * worked out from the link (see linkIcon). */
export function platformIcon(platform, className = "", url = "") {
  const key = String(platform || "").toLowerCase();
  return PLATFORM_ICONS.has(key) ? icon(key, className) : linkIcon(url, className);
}

export function faviconURL(url) {
  const link = parseLink(url);
  if (!link || !/^https?:$/.test(link.protocol) || !link.hostname) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(link.hostname)}&sz=64`;
}

/* ------------------------------------------------------------------
 * Output safety
 *
 * These render database- and API-supplied strings. `escapeHTML` covers
 * text nodes. `escapeAttr` additionally escapes quotes so a value
 * cannot break out of an attribute. `safeURL` refuses anything that is
 * not http(s), so a stored `javascript:` URL cannot execute on click.
 * ------------------------------------------------------------------ */
export function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

export function escapeAttr(value) {
  return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function safeURL(value) {
  const raw = String(value == null ? "" : value).trim();
  return /^https?:\/\//i.test(raw) ? escapeAttr(raw) : "";
}

/* The links a person filled in, in a fixed order, each with its icon.
 * Discord has no linkable profile, so it is a copy button. */
export const PERSON_LINKS = [
  ["github", (m) => m.github_username && `https://github.com/${encodeURIComponent(m.github_username)}`, "GitHub"],
  ["linkedin", (m) => m.linkedin_url, "LinkedIn"],
  ["instagram", (m) => m.instagram_url, "Instagram"],
  ["x", (m) => m.x_url, "X"],
  ["globe", (m) => m.website_url, "Website"],
  ["mail", (m) => m.email && `mailto:${m.email}`, "Email"],
];

/* An image source: http(s), or a base64 data: image (the admin panel's
 * preview of a photo that has not been uploaded yet). Nothing else. */
function safeImageURL(value) {
  const raw = String(value == null ? "" : value).trim();
  if (/^data:image\/(png|webp|jpeg);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
  return safeURL(raw);
}

/* size 24 is the pixel-art portrait, anything larger the real photo.
 * An uploaded photo wins; otherwise the GitHub avatar. */
export function avatarURL(member, size) {
  if (size <= 24 && member.photo_thumb_url) return safeImageURL(member.photo_thumb_url);
  if (size > 24 && member.photo_url) return safeImageURL(member.photo_url);
  if (!member.github_username) return "";
  return safeURL(`https://github.com/${encodeURIComponent(member.github_username)}.png?size=${size}`);
}

/* A 24px avatar blown up with hard pixels, with the real photo stacked
 * on top and clipped away. The photo's src waits in data-src until
 * someone looks at the person, so a long roster costs 24px avatars. */
export function portraitHTML(member, className = "") {
  const pixel = avatarURL(member, 24);
  const photo = avatarURL(member, 192);
  const initial = escapeHTML(String(member.name || "?").trim().charAt(0).toUpperCase());
  return `
    <span class="portrait ${className}" aria-hidden="true">
      ${pixel
        ? `<img class="portrait-pixel" src="${pixel}" width="24" height="24" alt="" loading="lazy" />`
        : `<span class="portrait-initial">${initial}</span>`}
      ${photo ? `<img class="portrait-photo" data-src="${photo}" alt="" />` : ""}
    </span>`;
}

export function roleStamp(member) {
  const role = member.role === "lead" ? "lead" : "mentor";
  return `<span class="stamp stamp-${role}">${role === "lead" ? "Lead" : "Mentor"}</span>`;
}

export function personLinksHTML(member) {
  const items = PERSON_LINKS
    .map(([iconName, toURL, label]) => {
      const url = safeURL(toURL(member) || "");
      // mailto: is not http(s), so safeURL refuses it; build it separately.
      const href = iconName === "mail" && member.email ? escapeAttr(`mailto:${member.email}`) : url;
      if (!href) return "";
      const external = iconName === "mail" ? "" : ' target="_blank" rel="noopener"';
      const glyph = iconName === "globe" ? linkIcon(url, "", "globe") : icon(iconName);
      return `<li><a href="${href}"${external} aria-label="${escapeAttr(`${member.name} on ${label}`)}">${glyph}</a></li>`;
    })
    .join("");
  const discord = member.discord_handle
    ? `<li><button type="button" class="core-discord join-copy" data-copy="${escapeAttr(member.discord_handle)}"
          aria-label="Copy ${escapeAttr(member.name)}'s Discord handle">${icon("discord")}<span class="join-copy-text">${escapeHTML(member.discord_handle)}</span></button></li>`
    : "";
  return items || discord ? `<ul class="core-links">${items}${discord}</ul>` : "";
}

export function whoisHTML(member) {
  const rows = [
    ["runs", member.group_name],
    ["focus", Array.isArray(member.focus) && member.focus.length ? member.focus.join(", ") : ""],
    ["since", member.joined_on ? String(member.joined_on).slice(0, 4) : ""],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  const handle = member.github_username || String(member.name || "").split(" ")[0].toLowerCase();
  return `
    <div class="core-whois">
      <p class="core-whois-cmd"><span aria-hidden="true">$</span> whois ${escapeHTML(handle)}</p>
      <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHTML(v)}</dd></div>`).join("")}</dl>
    </div>`;
}

/* One card for every core member — lead or mentor — the same shape and
 * the same size. The old design gave mentors a visibly smaller card
 * than leads; that size difference read as a hierarchy nobody intended,
 * and is why the club ended up marking everyone as a lead. Here the
 * band's colour and label are the only thing that differs.
 *
 * The front is an ID badge: portrait, name, title, handle. Clicking
 * "Full profile" (or pressing Enter/Space on it) flips the card over
 * to a back face with the dossier: what they run, their focus, their
 * bio and their links — the same depth of information a lead's card
 * always had, now available for a mentor's too. bindCoreMembers() in
 * main.js wires up the flip and a cursor-following tilt; the CSS still
 * works, minus the flourish, if that never runs.
 *
 * The tilt is a small, fixed angle per position, so a wall of cards
 * looks pinned up rather than printed. */
const CARD_TILTS = [-1.2, 0.9, -0.5, 1.3, -0.9, 0.4, -1.4, 0.7];

export function coreCardHTML(member, index = 0) {
  const since = member.joined_on ? String(member.joined_on).slice(0, 4) : "";
  const handle = member.github_username
    ? `<a class="core-handle" href="${safeURL(`https://github.com/${encodeURIComponent(member.github_username)}`)}" target="_blank" rel="noopener">@${escapeHTML(member.github_username)}</a>`
    : "";
  const role = member.role === "lead" ? "Lead" : "Mentor";
  const name = escapeHTML(member.name);
  const dossier = `${whoisHTML(member)}${member.bio ? `<p class="core-bio">${escapeHTML(member.bio)}</p>` : ""}${personLinksHTML(member)}`;

  return `
    <article class="core-card badge-${member.role === "lead" ? "lead" : "mentor"}" data-person-card
             style="--tilt: ${CARD_TILTS[index % CARD_TILTS.length]}deg">
      <div class="core-card-inner">
        <div class="core-card-face core-card-front">
          <header class="badge-band">
            <span>${role}</span>
            ${since ? `<span>Since ${escapeHTML(since)}</span>` : ""}
          </header>
          <div class="badge-body">
            <div class="badge-id">
              ${portraitHTML(member, "portrait-md")}
              <div class="badge-who">
                <h3 class="core-name">${name}</h3>
                ${member.title ? `<p class="core-title">${escapeHTML(member.title)}</p>` : ""}
                ${handle}
              </div>
            </div>
            <button type="button" class="core-flip-cue" data-flip aria-label="Show ${name}'s full profile">
              Full profile <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        </div>
        <div class="core-card-face core-card-back">
          <header class="badge-band">
            <span>${name}</span>
            <button type="button" class="core-flip-back" data-flip aria-label="Back to ${name}'s card">${icon("close")}</button>
          </header>
          <div class="badge-body badge-body-back">
            ${dossier || `<p class="empty-note">Nothing filed yet.</p>`}
          </div>
        </div>
      </div>
    </article>`;
}

/* ---- resources, study groups, events --------------------------- */
export const RESOURCE_KIND_LABELS = {
  notes: "Notes", video: "Video", paper: "Paper",
  course: "Course", tool: "Tool", book: "Book",
};

export function resourceCardHTML(resource) {
  const href = safeURL(resource.url);
  if (!href) return "";

  return `
    <a class="resource-card" href="${href}" target="_blank" rel="noopener">
      <span class="resource-card-top">
        <span class="resource-kind">${escapeHTML(RESOURCE_KIND_LABELS[resource.kind] || resource.kind || "Resource")}</span>
        ${resource.via_github ? `<span class="resource-origin">via GitHub</span>` : ""}
        ${linkIcon(href, "resource-ext", "external-link")}
      </span>
      <h3>${escapeHTML(resource.title)}</h3>
      ${resource.summary ? `<p>${escapeHTML(resource.summary)}</p>` : ""}
      ${resource.curated_note ? `<span class="mini-label">${escapeHTML(resource.curated_note)}</span>` : ""}
      ${resource.group_name ? `<span class="mini-label">${escapeHTML(resource.group_name)}</span>` : ""}
    </a>
  `;
}

export function studyGroupCardHTML(group) {
  // Status is a free-text column, so the class is derived defensively:
  // an unknown status falls back to a neutral tag rather than producing
  // a bare class that styles nothing.
  const status = String(group.status || "").trim();
  const slug = status.toLowerCase().replace(/[^a-z]+/g, "-");
  const known = ["active", "forming", "paused", "completed"];
  const statusClass = known.includes(slug) ? `tag-${slug}` : "tag-upcoming";
  const href = safeURL(group.link);

  const link = href
    ? `<a class="site-link" href="${href}" target="_blank" rel="noopener">${linkIcon(href)}<span>${escapeHTML(group.link_text || "Open the group")} &rarr;</span></a>`
    : "";

  return `
    <article class="group-card">
      <div class="group-card-top">
        <h3>${escapeHTML(group.name)}</h3>
        ${status ? `<span class="tag ${statusClass}">${escapeHTML(status)}</span>` : ""}
      </div>
      <p>${escapeHTML(group.topic)}</p>
      ${link}
    </article>
  `;
}

export function eventCardHTML(event) {
  const start = new Date(event.starts_at);
  // display_state, never event.stage: stage is what a maintainer typed,
  // and only the derived value accounts for the clock.
  const state = event.display_state;
  const isLive = state === "live";

  const label = isLive ? "LIVE NOW" : state === "upcoming" ? "UPCOMING" : "FINISHED";
  const href = safeURL(event.link);

  const links = [];
  if (href) {
    links.push(`<a class="site-link" href="${href}" target="_blank" rel="noopener">${linkIcon(href)}<span>${escapeHTML(event.link_text || "Open event")} &rarr;</span></a>`);
  }
  if (state !== "finished") {
    links.push(`<button type="button" class="link-button" data-ics-single="${escapeAttr(event.id)}">Add to calendar</button>`);
    links.push(`<button type="button" class="link-button" data-notify="${escapeAttr(event.id)}">Email me updates</button>`);
  }

  const tag = isLive
    ? '<span class="tag tag-live"><span class="live-dot" aria-hidden="true"></span>LIVE NOW</span>'
    : `<span class="tag tag-${state}">${label}</span>`;

  return `
    <article class="event-card${isLive ? " is-live" : ""}">
      <div class="event-date">
        <span>${escapeHTML(start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</span>
        <strong>${escapeHTML(start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}</strong>
      </div>
      <div class="event-main">
        <div class="event-card-top">
          <div>
            ${event.group_name ? `<span class="mini-label">${escapeHTML(event.group_name)}</span>` : ""}
            <h3>${escapeHTML(event.title)}</h3>
          </div>
          ${tag}
        </div>
        ${event.details ? `<p>${escapeHTML(event.details)}</p>` : ""}
        ${links.length ? `<div class="event-links">${links.join("")}</div>` : ""}
      </div>
    </article>
  `;
}
