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
export const PLATFORM_ICONS = new Set(["discord", "instagram", "whatsapp", "github"]);

export function platformIcon(platform, className = "") {
  const key = String(platform || "").toLowerCase();
  return icon(PLATFORM_ICONS.has(key) ? key : "link", className);
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

export function avatarURL(member, size) {
  if (member.photo_url && size > 24) return safeURL(member.photo_url);
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
      return `<li><a href="${href}"${external} aria-label="${escapeAttr(`${member.name} on ${label}`)}">${icon(iconName)}</a></li>`;
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

/* The personnel file. Used for lead cards and inside expanded rows. */
export function personFileHTML(member, { withPortrait = true } = {}) {
  const handle = member.github_username
    ? `<a class="core-handle" href="${safeURL(`https://github.com/${encodeURIComponent(member.github_username)}`)}" target="_blank" rel="noopener">@${escapeHTML(member.github_username)}</a>`
    : "";
  return `
    <div class="core-file">
      <div class="core-file-head">
        ${withPortrait ? portraitHTML(member, "portrait-lg") : ""}
        <div class="core-file-id">
          ${roleStamp(member)}
          <h3 class="core-name">${escapeHTML(member.name)}</h3>
          ${member.title ? `<p class="core-title">${escapeHTML(member.title)}</p>` : ""}
          ${handle}
        </div>
      </div>
      ${whoisHTML(member)}
      ${member.bio ? `<p class="core-bio">${escapeHTML(member.bio)}</p>` : ""}
      ${personLinksHTML(member)}
    </div>`;
}

/* A mentor's ID badge: role band on top, then everything at rest, with
 * empty fields left out. The tilt is a small, fixed angle per position,
 * so a wall of badges looks pinned up rather than printed. */
const BADGE_TILTS = [-1.2, 0.9, -0.5, 1.3, -0.9, 0.4, -1.4, 0.7];

export function mentorBadgeHTML(member, index = 0) {
  const since = member.joined_on ? String(member.joined_on).slice(0, 4) : "";
  const handle = member.github_username
    ? `<a class="core-handle" href="${safeURL(`https://github.com/${encodeURIComponent(member.github_username)}`)}" target="_blank" rel="noopener">@${escapeHTML(member.github_username)}</a>`
    : "";
  const tags = Array.isArray(member.focus) && member.focus.length
    ? `<ul class="badge-tags">${member.focus.map((t) => `<li>${escapeHTML(t)}</li>`).join("")}</ul>`
    : "";
  const role = member.role === "lead" ? "Lead" : "Mentor";

  return `
    <article class="core-badge badge-${member.role === "lead" ? "lead" : "mentor"}" data-person-card
             style="--tilt: ${BADGE_TILTS[index % BADGE_TILTS.length]}deg">
      <header class="badge-band">
        <span>${role}</span>
        ${since ? `<span>Since ${escapeHTML(since)}</span>` : ""}
      </header>
      <div class="badge-body">
        <div class="badge-id">
          ${portraitHTML(member, "portrait-md")}
          <div class="badge-who">
            <h3 class="core-name">${escapeHTML(member.name)}</h3>
            ${member.title ? `<p class="core-title">${escapeHTML(member.title)}</p>` : ""}
            ${handle}
          </div>
        </div>
        ${member.group_name ? `<p class="badge-runs"><span>Runs</span> ${escapeHTML(member.group_name)}</p>` : ""}
        ${tags}
        ${member.bio ? `<p class="core-bio">${escapeHTML(member.bio)}</p>` : ""}
        ${personLinksHTML(member)}
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
        ${icon("external-link", "resource-ext")}
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
    ? `<a href="${href}" target="_blank" rel="noopener">${escapeHTML(group.link_text || "Open the group")} &rarr;</a>`
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
    links.push(`<a href="${href}" target="_blank" rel="noopener">${escapeHTML(event.link_text || "Open event")} &rarr;</a>`);
  }
  if (state !== "finished") {
    links.push(`<button type="button" class="link-button" data-ics-single="${escapeAttr(event.id)}">Add to calendar</button>`);
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
