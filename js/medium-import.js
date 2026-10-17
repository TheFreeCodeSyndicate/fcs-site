/**
 * js/medium-import.js
 * ------------------------------------------------------------------
 * Medium Import Wizard: multi-step dialog for importing articles from
 * Medium RSS feeds or story URLs.
 *
 * Steps:
 * 1. Find: enter handle or story URL, display feed cards or load story.
 * 2. Choose: pick sections to import with live markdown preview.
 * 3. Confirm: copyright attestation, attribution, duplicate check,
 *    and submission to backend.
 * ------------------------------------------------------------------
 */

import { mediumFeed, mediumStory, mediumImport } from "./supabase.js";
import { renderMarkdown } from "./lib/markdown.js";
import {
  clipTitle,
  excerptFor,
  applyShortcut,
  summarise,
  findDuplicate,
  storyAddress,
  listHint,
} from "./lib/medium-wizard.js";
import { escapeHTML, escapeAttr, safeURL } from "./render.js";

let open = null;

export function closeMediumImport() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener("pointerdown", open.outside, true);
  document.removeEventListener("keydown", open.esc, true);
  if (open.returnFocus && typeof open.returnFocus.focus === "function") {
    open.returnFocus.focus();
  }
  open = null;
}

/**
 * Formats an ISO or RFC date string for display.
 *
 * @param {string} str
 * @returns {string}
 */
function formatDate(str) {
  if (!str) return "";
  const d = new Date(str);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Opens the Medium Import modal dialog.
 *
 * @param {object} opts
 * @param {"new"|"insert"} opts.mode         which button the last step offers
 * @param {Array<{id,title,source_url}>} [opts.existing]  for the duplicate warning
 * @param {(msg: string, tone?: string) => void} opts.toast
 * @param {(draft: { title: string, excerpt: string, body: string, cover_url: string, source_url: string }) => void} [opts.onCreate]  mode "new"
 * @param {(markdown: string) => void} [opts.onInsert] mode "insert"
 * @param {(clash: { id?: string, title?: string, source_url?: string }) => void} [opts.onOpenPost]
 */
export function openMediumImport(opts = {}) {
  closeMediumImport();

  const returnFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "mi-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "mi-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Import from Medium");
  overlay.appendChild(dialog);

  document.body.appendChild(overlay);

  // State
  let currentStep = 1; // 1: Find, 2: Choose, 3: Confirm
  let currentSource = null;
  let currentStoryData = null; // { source, sections, dropped, warnings }
  let selectedSectionIds = new Set();
  let duplicateOverridden = false;
  let previewRaf = null;
  let knownFeedHandle = null;

  function render() {
    dialog.innerHTML = "";
    if (currentStep === 1) {
      renderStep1();
    } else if (currentStep === 2) {
      renderStep2();
    } else if (currentStep === 3) {
      renderStep3();
    }
  }

  /* ------------------------------------------------------------------
     STEP 1: FIND
     ------------------------------------------------------------------ */
  function renderStep1(initialError = "", initialStories = null) {
    dialog.innerHTML = `
      <div class="mi-header">
        <h2>Import from Medium</h2>
        <button type="button" class="mi-close" aria-label="Close dialog">&times;</button>
      </div>
      <div class="mi-body">
        <form class="mi-find-bar" data-find-form>
          <input
            type="text"
            class="mi-input"
            data-input
            placeholder="Paste a Medium story link, or type @yourhandle"
            aria-label="Medium story link or author handle"
          />
          <button type="submit" class="btn btn-primary" data-find-btn>Find</button>
        </form>
        <div class="mi-error" data-error ${initialError ? "" : "hidden"}>${escapeHTML(initialError)}</div>
        <div class="mi-loading" data-loading hidden>Looking up Medium feed…</div>
        <div class="mi-results" data-results></div>
      </div>
    `;

    const closeBtn = dialog.querySelector(".mi-close");
    closeBtn.addEventListener("click", closeMediumImport);

    const form = dialog.querySelector("[data-find-form]");
    const input = dialog.querySelector("[data-input]");
    const findBtn = dialog.querySelector("[data-find-btn]");
    const errBox = dialog.querySelector("[data-error]");
    const loadingBox = dialog.querySelector("[data-loading]");
    const resultsBox = dialog.querySelector("[data-results]");

    const showLoading = (busy) => {
      loadingBox.hidden = !busy;
      findBtn.disabled = busy;
      input.disabled = busy;
    };

    const showError = (msg) => {
      if (msg) {
        errBox.textContent = msg;
        errBox.hidden = false;
      } else {
        errBox.textContent = "";
        errBox.hidden = true;
      }
    };

    const paintStories = (stories, authorHandle = null, { missedStory = false } = {}) => {
      if (!Array.isArray(stories) || stories.length === 0) {
        resultsBox.innerHTML = `<div class="mi-empty"><p>No stories found for that author.</p></div>`;
        return;
      }

      const cardsHtml = stories.map((s) => {
        const isImportable = s.importable !== false;
        const clash = findDuplicate(opts.existing, s.url);
        const dateStr = formatDate(s.publishedAt || s.published_at);
        return `
          <div class="mi-story-card${isImportable ? "" : " is-disabled"}" data-url="${escapeAttr(s.url)}" ${isImportable ? 'tabindex="0" role="button"' : 'aria-disabled="true"'}>
            <div class="mi-story-main">
              <div class="mi-story-header">
                ${dateStr ? `<time class="mi-story-date">${escapeHTML(dateStr)}</time>` : ""}
                ${clash ? `<span class="badge">Already imported</span>` : ""}
                ${s.publication ? `<span class="badge badge-muted">${escapeHTML(s.publication)}</span>` : ""}
              </div>
              <h3 class="mi-story-title">${escapeHTML(s.title || "Untitled")}</h3>
              ${s.excerpt ? `<p class="mi-story-summary">${escapeHTML(s.excerpt)}</p>` : ""}
              ${!isImportable && s.reason ? `<p class="mi-story-reason">${escapeHTML(s.reason)}</p>` : ""}
            </div>
            ${s.thumbnail ? `<div class="mi-story-thumb"><img src="${safeURL(s.thumbnail)}" alt="" loading="lazy" /></div>` : ""}
            ${isImportable ? `<div class="mi-story-action"><button type="button" class="btn btn-quiet" data-pick="${escapeAttr(s.url)}">Choose</button></div>` : ""}
          </div>
        `;
      }).join("");

      resultsBox.innerHTML = `
        <div class="mi-story-list">${cardsHtml}</div>
        <p class="mi-hint">${escapeHTML(listHint({ missedStory }))}</p>
      `;

      // Event listeners for story selection
      resultsBox.querySelectorAll(".mi-story-card:not(.is-disabled)").forEach((card) => {
        const pickStory = async () => {
          const url = card.dataset.url;
          if (!url) return;
          showLoading(true);
          showError("");
          try {
            const storyRes = await mediumStory(url, authorHandle || knownFeedHandle || null);
            if (Array.isArray(storyRes.stories)) {
              showLoading(false);
              showError(storyRes.error || "That story could not be loaded.");
              paintStories(storyRes.stories, authorHandle, { missedStory: true });
              return;
            }
            currentStoryData = storyRes;
            currentSource = storyRes.source;
            selectedSectionIds = new Set((storyRes.sections || []).map((sec) => sec.id));
            currentStep = 2;
            render();
          } catch (err) {
            showLoading(false);
            showError(err.message || "Failed to load story.");
          }
        };

        card.addEventListener("click", (e) => {
          if (e.target.closest("button[data-pick]") || !e.target.closest("button")) {
            pickStory();
          }
        });
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pickStory();
          }
        });
      });
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;

      showError("");
      resultsBox.innerHTML = "";
      showLoading(true);

      const directStoryUrl = storyAddress(val);
      if (directStoryUrl) {
        knownFeedHandle = null;
        try {
          const storyRes = await mediumStory(directStoryUrl);
          showLoading(false);
          if (Array.isArray(storyRes.stories)) {
            // Not in newest ten: server error sentence + stories list + ten-story hint
            showError(storyRes.error || "That story is not in the newest ten.");
            paintStories(storyRes.stories, null, { missedStory: true });
            return;
          }
          currentStoryData = storyRes;
          currentSource = storyRes.source;
          selectedSectionIds = new Set((storyRes.sections || []).map((sec) => sec.id));
          currentStep = 2;
          render();
        } catch (err) {
          showLoading(false);
          showError(err.message || "Failed to load story.");
        }
      } else {
        try {
          const feedRes = await mediumFeed(val);
          showLoading(false);
          knownFeedHandle = feedRes.source?.handle || null;
          currentSource = feedRes.source;
          paintStories(feedRes.stories, feedRes.source?.handle);
        } catch (err) {
          showLoading(false);
          showError(err.message || "Failed to load feed.");
        }
      }
    });

    if (initialStories) {
      paintStories(initialStories);
    }

    input.focus();
  }

  /* ------------------------------------------------------------------
     STEP 2: CHOOSE
     ------------------------------------------------------------------ */
  function renderStep2() {
    const { source, sections = [], dropped = [] } = currentStoryData || {};
    dialog.innerHTML = `
      <div class="mi-header">
        <div class="mi-header-title">
          <h2>Choose content to import</h2>
        </div>
        <button type="button" class="mi-close" aria-label="Close dialog">&times;</button>
      </div>
      <div class="mi-body">
        <div class="mi-story-summary-card">
          <h3 class="mi-story-summary-title">${escapeHTML(source?.title || "Untitled")}</h3>
          <p class="mi-story-summary-meta">
            ${source?.author ? `<span>By ${escapeHTML(source.author)}</span>` : ""}
            ${source?.url ? `<a href="${safeURL(source.url)}" target="_blank" rel="noopener noreferrer">View original on Medium</a>` : ""}
          </p>
        </div>

        <div class="mi-choose-grid">
          <div class="mi-sections-col">
            <div class="mi-shortcuts">
              <span class="mi-shortcuts-label">Select:</span>
              <button type="button" class="chip" data-shortcut="all">All</button>
              <button type="button" class="chip" data-shortcut="none">None</button>
              <button type="button" class="chip" data-shortcut="text">Text only</button>
              <button type="button" class="chip" data-shortcut="images">Images only</button>
            </div>
            <div class="mi-section-list" role="group" aria-label="Sections to import" data-sections-list>
              ${sections.map((sec) => `
                <label class="mi-section-row">
                  <input type="checkbox" data-id="${escapeAttr(sec.id)}" ${selectedSectionIds.has(sec.id) ? "checked" : ""} />
                  <span class="badge mi-kind-badge">${escapeHTML(sec.kind || "text")}</span>
                  <span class="mi-section-label">${escapeHTML(sec.label || "")}</span>
                  ${sec.kind === "image" && sec.images && sec.images[0] ? `<img class="mi-section-thumb" src="${safeURL(sec.images[0])}" alt="" loading="lazy" />` : ""}
                </label>
              `).join("")}
            </div>
            ${dropped.length > 0 ? `
              <div class="mi-dropped-notice">${dropped.length} unsupported embed${dropped.length === 1 ? " was" : "s were"} dropped.</div>
            ` : ""}
          </div>

          <div class="mi-preview-col">
            <div class="mi-preview-wrap">
              <div class="mi-preview-head">Live Preview</div>
              <div class="mi-preview" data-preview></div>
            </div>
          </div>
        </div>

        <div class="mi-foot">
          <button type="button" class="btn btn-quiet" data-back>← Back to stories</button>
          <div class="mi-foot-right">
            <button type="button" class="btn btn-primary" data-continue ${selectedSectionIds.size === 0 ? "disabled" : ""}>
              Continue to Confirm
            </button>
          </div>
        </div>
      </div>
    `;

    const closeBtn = dialog.querySelector(".mi-close");
    closeBtn.addEventListener("click", closeMediumImport);

    const backBtn = dialog.querySelector("[data-back]");
    backBtn.addEventListener("click", () => {
      currentStep = 1;
      render();
    });

    const continueBtn = dialog.querySelector("[data-continue]");
    continueBtn.addEventListener("click", () => {
      currentStep = 3;
      render();
    });

    const previewEl = dialog.querySelector("[data-preview]");
    const sectionListEl = dialog.querySelector("[data-sections-list]");

    function updateLivePreview() {
      if (previewRaf) cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(() => {
        const kept = sections.filter((s) => selectedSectionIds.has(s.id));
        const md = kept.map((s) => s.markdown).join("\n\n");
        previewEl.innerHTML = renderMarkdown(md);
        continueBtn.disabled = selectedSectionIds.size === 0;
      });
    }

    // Shortcut chips
    dialog.querySelectorAll("[data-shortcut]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const name = chip.dataset.shortcut;
        const newIds = applyShortcut(name, sections);
        selectedSectionIds = new Set(newIds);
        sectionListEl.querySelectorAll("input[data-id]").forEach((cb) => {
          cb.checked = selectedSectionIds.has(cb.dataset.id);
        });
        updateLivePreview();
      });
    });

    // Checkbox toggles
    sectionListEl.addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-id]");
      if (!cb) return;
      if (cb.checked) {
        selectedSectionIds.add(cb.dataset.id);
      } else {
        selectedSectionIds.delete(cb.dataset.id);
      }
      updateLivePreview();
    });

    updateLivePreview();
    continueBtn.focus();
  }

  /* ------------------------------------------------------------------
     STEP 3: CONFIRM
     ------------------------------------------------------------------ */
  function renderStep3() {
    const { source, sections = [] } = currentStoryData || {};
    const clash = findDuplicate(opts.existing, source?.url);
    const showDuplicateNotice = Boolean(clash && !duplicateOverridden);

    dialog.innerHTML = `
      <div class="mi-header">
        <h2>Confirm Import</h2>
        <button type="button" class="mi-close" aria-label="Close dialog">&times;</button>
      </div>
      <div class="mi-body">
        <div class="mi-story-summary-card">
          <h3 class="mi-story-summary-title">${escapeHTML(source?.title || "Untitled")}</h3>
          <p class="mi-story-summary-meta">
            <span>${selectedSectionIds.size} section${selectedSectionIds.size === 1 ? "" : "s"} selected</span>
            ${source?.url ? `<a href="${safeURL(source.url)}" target="_blank" rel="noopener noreferrer">View original on Medium</a>` : ""}
          </p>
        </div>

        <div class="mi-warning-block">
          <h4 class="mi-warning-title">Before you import</h4>
          <p class="mi-warning-text">Only import your own writing, or work you have permission to republish.
This copies a public Medium story into a post on this site. If it is not
yours, republishing it can infringe someone's copyright — and the club is
the one that receives the complaint.</p>
          <label class="mi-checkbox-row">
            <input type="checkbox" data-permission required />
            <span>This is my own article, or I have the author's permission to republish it. <em>(required)</em></span>
          </label>
          <label class="mi-checkbox-row">
            <input type="checkbox" data-attribution checked />
            <span>Add "Originally published on Medium", linked to the original, at the end.</span>
          </label>
        </div>

        ${showDuplicateNotice ? `
          <div class="mi-duplicate-box" data-duplicate-box>
            <p>You already imported this story as <strong>${escapeHTML(clash.title || "Untitled")}</strong>.</p>
            <div class="mi-duplicate-actions">
              <button type="button" class="btn" data-open-post>Open that post</button>
              <button type="button" class="btn" data-import-anyway>Import anyway</button>
            </div>
          </div>
        ` : ""}

        <div class="mi-error" data-submit-error hidden></div>

        <div class="mi-foot">
          <button type="button" class="btn btn-quiet" data-back>← Back to sections</button>
          <div class="mi-foot-right">
            ${showDuplicateNotice ? "" : `
              <button type="button" class="btn btn-primary" data-submit disabled>
                ${opts.mode === "new" ? "Create a new draft" : "Insert into this post"}
              </button>
            `}
          </div>
        </div>
      </div>
    `;

    const closeBtn = dialog.querySelector(".mi-close");
    closeBtn.addEventListener("click", closeMediumImport);

    const backBtn = dialog.querySelector("[data-back]");
    backBtn.addEventListener("click", () => {
      currentStep = 2;
      render();
    });

    const permCb = dialog.querySelector("[data-permission]");
    const attrCb = dialog.querySelector("[data-attribution]");
    const submitBtn = dialog.querySelector("[data-submit]");
    const errBox = dialog.querySelector("[data-submit-error]");

    if (showDuplicateNotice) {
      const openPostBtn = dialog.querySelector("[data-open-post]");
      const importAnywayBtn = dialog.querySelector("[data-import-anyway]");

      openPostBtn.addEventListener("click", () => {
        if (typeof opts.onOpenPost === "function") {
          opts.onOpenPost(clash);
        } else if (typeof opts.toast === "function") {
          opts.toast("This post is already in the list.", "info");
        }
        closeMediumImport();
      });

      importAnywayBtn.addEventListener("click", () => {
        duplicateOverridden = true;
        renderStep3();
      });
    }

    if (submitBtn) {
      permCb.addEventListener("change", () => {
        submitBtn.disabled = !permCb.checked;
      });

      submitBtn.addEventListener("click", async () => {
        if (!permCb.checked) return;

        submitBtn.disabled = true;
        submitBtn.textContent = "Copying images... this can take a minute";
        backBtn.disabled = true;
        errBox.hidden = true;
        errBox.textContent = "";

        const kept = sections.filter((s) => selectedSectionIds.has(s.id));
        const keptIds = kept.map((s) => s.id);
        const attribution = attrCb.checked;

        try {
          // Ruling R17: server handles attribution line appending via 4th argument
          const result = await mediumImport(source.url, keptIds, knownFeedHandle, attribution);
          const { markdown, cover, images = {}, warnings = [] } = result;

          if (opts.mode === "new") {
            const title = clipTitle(source.title, 160) || "Untitled Medium Story";
            const excerpt = excerptFor(markdown);
            const draft = {
              title,
              excerpt,
              body: markdown,
              cover_url: (cover && cover.url) || "",
              source_url: source.url,
            };
            if (typeof opts.onCreate === "function") {
              opts.onCreate(draft);
            }
          } else if (opts.mode === "insert") {
            if (typeof opts.onInsert === "function") {
              opts.onInsert(markdown);
            }
          }

          const toastSummary = summarise(warnings, images);
          if (typeof opts.toast === "function") {
            opts.toast(toastSummary.message, toastSummary.tone);
          }

          closeMediumImport();
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = opts.mode === "new" ? "Create a new draft" : "Insert into this post";
          backBtn.disabled = false;
          errBox.textContent = err.message || "Failed to import story.";
          errBox.hidden = false;
        }
      });
    }

    permCb.focus();
  }

  // Register open handle
  open = {
    el: overlay,
    returnFocus,
    outside: (e) => {
      if (!dialog.contains(e.target)) {
        closeMediumImport();
      }
    },
    esc: (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMediumImport();
      }
    },
  };

  document.addEventListener("pointerdown", open.outside, true);
  document.addEventListener("keydown", open.esc, true);

  render();
}
