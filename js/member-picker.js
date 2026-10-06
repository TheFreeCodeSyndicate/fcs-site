/**
 * js/member-picker.js
 * ------------------------------------------------------------------
 * "Which member card are you?" A small popover listing the core-member
 * cards, the email-matched guess first; picking one asks for
 * confirmation in the same popover. Used on the Team page and in the
 * blog editor's Authors row. Saving is the caller's (onConfirm).
 * ------------------------------------------------------------------
 */

import { avatarHTML } from "./lib/blog-pages.js";
import { escapeHTML } from "./render.js";

/** A core_members row as the picker shows it. */
export const memberCard = (m) => ({
  id: m.id,
  name: m.name,
  avatar: m.photo_url || (m.github_username ? `https://github.com/${m.github_username}.png?size=96` : ""),
});

let open = null;

export function closeMemberPicker() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener("pointerdown", open.outside, true);
  document.removeEventListener("keydown", open.esc, true);
  open = null;
}

/**
 * anchor: the button it opens from. members: cards (memberCard shape).
 * current: the linked card's id. suggested: the guessed card. taken: ids linked to other logins.
 * onConfirm(card): async; throw to keep the popover open.
 */
export function openMemberPicker(anchor, { members, current = null, suggested = null, taken = new Set(), onConfirm }) {
  closeMemberPicker();
  const el = document.createElement("div");
  el.className = "nb-pop nb-menu nb-member-pop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Which member card are you?");
  el.style.width = "300px";
  (anchor.closest(".nb") || document.body).append(el);

  const place = () => {
    const r = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const below = innerHeight - r.bottom - 14;
    el.style.maxHeight = `${Math.max(below, r.top - 14, 160)}px`;
    el.style.top = `${box.height <= below || below >= r.top ? r.bottom + 6 : Math.max(8, r.top - 6 - box.height)}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - box.width - 8))}px`;
  };

  const showList = () => {
    el.innerHTML = `
      <div class="nb-list-search"><input type="text" placeholder="Search member cards" aria-label="Search member cards" data-q /></div>
      <div class="nb-list" role="listbox" data-list></div>
      <div class="nb-menu-foot"><span>Your name and picture on posts come from this card</span></div>`;
    const q = el.querySelector("[data-q]");
    const list = el.querySelector("[data-list]");
    const paint = () => {
      const low = q.value.trim().toLowerCase();
      const hits = members.filter((m) => !low || m.name.toLowerCase().includes(low));
      const top = !low && suggested && suggested.id !== current ? [suggested] : [];
      const row = (m) => {
        const mine = m.id === current;
        const busy = taken.has(m.id) && !mine;
        return `<button type="button" class="nb-item${mine ? " is-picked" : ""}" data-id="${escapeHTML(m.id)}"${busy ? " disabled" : ""}>
          ${avatarHTML(m, "avatar nb-item-avatar")}
          <span class="nb-item-label">${escapeHTML(m.name)}${mine ? "<small>Your card</small>" : busy ? "<small>Linked to another account</small>" : ""}</span></button>`;
      };
      list.innerHTML = (top.length ? `<p class="nb-pop-section">Suggested from your email</p>${top.map(row).join("")}` : "")
        + (hits.length ? `<p class="nb-pop-section">Core members</p>${hits.map(row).join("")}` : '<p class="nb-pop-empty">No card by that name.</p>');
    };
    paint();
    q.addEventListener("input", paint);
    q.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = list.querySelector("[data-id]:not(:disabled)");
      if (first) first.click();
    });
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (!b || b.disabled) return;
      const card = members.find((m) => m.id === b.dataset.id);
      if (card.id === current) return closeMemberPicker();
      showConfirm(card);
    });
    place();
    q.focus();
  };

  const showConfirm = (card) => {
    el.innerHTML = `
      <div class="nb-member-confirm">
        <div class="nb-member-who">${avatarHTML(card)}<span>${escapeHTML(card.name)}</span></div>
        <p>Link your account to this card? Posts will show this name and picture. You can change it later on the Team page.</p>
        <div class="nb-member-actions"><button type="button" data-back>Choose another</button><button type="button" data-yes>Yes, that's me</button></div>
      </div>`;
    const yes = el.querySelector("[data-yes]");
    el.querySelector("[data-back]").addEventListener("click", showList);
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      yes.textContent = "Saving…";
      try {
        await onConfirm(card);
        closeMemberPicker();
      } catch {
        yes.disabled = false;
        yes.textContent = "Yes, that's me";
      }
    });
    place();
    yes.focus();
  };

  open = {
    el,
    // Inside the popover, or on the button that opened it, is not "outside".
    outside: (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMemberPicker(); },
    esc: (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMemberPicker(); anchor.focus(); } },
  };
  document.addEventListener("pointerdown", open.outside, true);
  document.addEventListener("keydown", open.esc, true);
  if (suggested && !current) showConfirm(suggested);
  else showList();
}
