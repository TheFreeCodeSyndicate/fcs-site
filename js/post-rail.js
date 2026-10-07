/*
 * js/post-rail.js
 * ------------------------------------------------------------------
 * The reading rail beside a blog post (markup: blog-pages.js railHTML),
 * after claude.dev's blog. Once the post's title scrolls away, the rail
 * fades in a piece at a time (icon, title, authors, then the contents),
 * lights the section you are reading, shows how far you are, and offers
 * share links. It leaves before the footer and when you scroll back up.
 * Wide screens only (style.css); on phones the post's own contents block
 * does the job. The contents come from the post's headings, so they are
 * there whether or not the post has a contents block of its own.
 *
 * Runs by itself on a published post; the editor's Preview mounts it on
 * its own scrolling pane (mountRail).
 * ------------------------------------------------------------------
 */
export function mountRail(rail, { scroller = window, root = document } = {}) {
  const prose = root.querySelector(".post .prose");
  const titleEl = root.querySelector(".post .post-title");
  if (!rail || !prose || !titleEl) return () => {};
  const viewH = () => (scroller === window ? innerHeight : scroller.getBoundingClientRect().bottom);
  const tree = rail.querySelector("[data-rail-tree]");
  const fill = rail.querySelector("[data-rail-fill]");
  const pct = rail.querySelector("[data-rail-pct]");
  const status = rail.querySelector("[data-rail-status]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  /* ---- the contents, from the headings (their ids come from the renderer) ---- */
  const headings = [...prose.querySelectorAll("h2[id], h3[id], h4[id], h5[id]")].filter((h) => !h.closest("details:not([open])"));
  // Sections (the top heading level) with their subheadings folded inside,
  // as on claude.dev: a section's subheadings open once you reach it.
  const levelOf = (h) => Number(h.tagName[1]);
  const top = headings.length ? Math.min(...headings.map(levelOf)) : 0;
  const sectionOf = [];   // heading index -> its section's index
  let section = -1;
  headings.forEach((h, i) => { if (levelOf(h) === top) section = i; sectionOf[i] = Math.max(section, 0); });
  if (headings.length) {
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const link = (h, i) => `<a href="#${encodeURIComponent(h.id)}" data-rail-to="${h.id}" data-i="${i}"><span class="rail-branch" aria-hidden="true">└</span><span>${esc(h.textContent.replace(/\s+/g, " ").trim())}</span></a>`;
    let html = "";
    headings.forEach((h, i) => {
      if (levelOf(h) !== top && i !== 0) return;
      const subs = headings.map((x, j) => [x, j]).filter(([x, j]) => j > i && sectionOf[j] === i && levelOf(x) !== top);
      html += `<li data-section="${i}">${link(h, i)}${subs.length ? `<div class="rail-sub"><ol>${subs.map(([x, j]) => `<li style="--depth: ${levelOf(x) - top - 1}">${link(x, j)}</li>`).join("")}</ol></div>` : ""}</li>`;
    });
    tree.innerHTML = html;
    rail.querySelector("[data-rail-tree-wrap]").hidden = false;
  }
  const links = [...tree.querySelectorAll("[data-rail-to]")].sort((a, b) => a.dataset.i - b.dataset.i);
  const sections = [...tree.querySelectorAll(":scope > li")];
  let pinned = -1; // a clicked entry stays lit while the page scrolls to it

  function light(current) {
    const sec = current < 0 ? -1 : sectionOf[current];
    links.forEach((a, i) => a.classList.toggle("is-current", i === current));
    sections.forEach((li) => {
      const mine = Number(li.dataset.section) === sec;
      li.classList.toggle("is-open", mine);
      li.classList.toggle("is-active", mine);
      const sub = li.querySelector(".rail-sub");
      if (sub) sub.toggleAttribute("inert", !mine); // folded entries are not tabbed to
    });
  }

  tree.addEventListener("click", (e) => {
    const a = e.target.closest("[data-rail-to]");
    if (!a) return;
    e.preventDefault();
    const target = root.querySelector(`#${CSS.escape(a.dataset.railTo)}`);
    pinned = Number(a.dataset.i);
    light(pinned);
    target.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
    // The address shows where you are, so it can be shared as is.
    history.replaceState(null, "", `#${encodeURIComponent(a.dataset.railTo)}`);
    clearTimeout(light.t);
    light.t = setTimeout(() => { pinned = -1; }, reduce.matches ? 0 : 900);
  });

  /* ---- shown between the title and the end of the post ---------------------- */
  let shown = false;
  const end = root.querySelector(".more-posts, .blog-footer");
  function update() {
    const pastTitle = titleEl.getBoundingClientRect().bottom < 0;
    // Gone before "More from the blog" (or the footer) comes into view.
    const beforeEnd = !end || end.getBoundingClientRect().top > viewH() - 24;
    const show = pastTitle && beforeEnd;
    if (show !== shown) {
      shown = show;
      rail.classList.toggle("is-shown", show);
      rail.toggleAttribute("inert", !show);
    }
    // How far through the post (its text, not the page).
    const r = prose.getBoundingClientRect();
    const done = Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - innerHeight * 0.6)));
    fill.style.transform = `scaleX(${done})`;
    pct.textContent = `${String(Math.round(done * 100)).padStart(2, "0")}%`;
    // The section being read: the last heading above a line a third down.
    let current = -1;
    headings.forEach((h, i) => { if (h.getBoundingClientRect().top < innerHeight * 0.33) current = i; });
    light(pinned >= 0 ? pinned : current);
  }
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  rail.setAttribute("inert", "");
  update();

  /* ---- share ------------------------------------------------------------- */
  const say = (text) => {
    status.textContent = text;
    clearTimeout(say.t);
    say.t = setTimeout(() => { status.textContent = ""; }, 2000);
  };
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers, or a page not served over https.
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.style.cssText = "position: fixed; opacity: 0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }
  rail.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-share]");
    if (!a || !a.dataset.share.startsWith("copy")) return;
    e.preventDefault();
    const text = a.dataset.share === "copy-url"
      ? rail.dataset.url
      : root.querySelector("#post-markdown").textContent.replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    const ok = await copy(text);
    say(ok ? (a.dataset.share === "copy-url" ? "Link copied" : "Markdown copied") : "Could not copy");
    a.classList.toggle("is-copied", ok);
    setTimeout(() => a.classList.remove("is-copied"), 1600);
  });
  return () => {
    scroller.removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
  };
}

// A published post: mount on the page itself.
const pageRail = document.querySelector("[data-rail]");
if (pageRail) mountRail(pageRail);
