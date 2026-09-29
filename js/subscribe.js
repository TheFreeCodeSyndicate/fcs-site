/*
 * js/subscribe.js
 * ------------------------------------------------------------------
 * The page behind the links in event emails:
 *   subscribe.html?confirm=<token>      confirms straight away
 *   subscribe.html?unsubscribe=<token>  asks first, with a button, so a
 *                                       mail scanner opening the link
 *                                       cannot unsubscribe anyone
 * ------------------------------------------------------------------
 */
import { eventMail } from "./supabase.js";
import { escapeHTML } from "./render.js";

const params = new URLSearchParams(location.search);
const title = document.getElementById("sub-title");
const text = document.getElementById("sub-text");
const actions = document.getElementById("sub-actions");

function show(heading, html, buttons = "") {
  title.textContent = heading;
  text.innerHTML = html;
  actions.innerHTML = buttons;
}

async function confirm(token) {
  try {
    const { email, list } = await eventMail("confirm", { token });
    show("You're subscribed", `<strong>${escapeHTML(email)}</strong> will get email updates about ${escapeHTML(list)}. Every email has an unsubscribe link.`,
      '<a class="btn-subscribe" href="./#events"><span>See the events</span></a>');
  } catch (err) {
    show("That link did not work", escapeHTML(err.message || "Try subscribing again from the events page."),
      '<a class="btn-subscribe" href="./#events"><span>Back to events</span></a>');
  }
}

async function unsubscribe(token) {
  let info;
  try {
    info = await eventMail("lookup", { token });
  } catch (err) {
    show("Already unsubscribed", escapeHTML(err.message || "This link has already been used."));
    return;
  }
  show("Unsubscribe?", `Stop email updates about ${escapeHTML(info.list)} to <strong>${escapeHTML(info.email)}</strong>?`, `
    <button type="button" class="btn-subscribe" data-everything="false"><span>Unsubscribe</span></button>
    <button type="button" class="btn-subscribe btn-subscribe-alt" data-everything="true"><span>Unsubscribe from everything</span></button>`);
  actions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        const { email, list } = await eventMail("unsubscribe", { token, everything: button.dataset.everything === "true" });
        show("You're unsubscribed", `<strong>${escapeHTML(email)}</strong> will get no more updates about ${escapeHTML(list)}.`,
          '<a class="btn-subscribe btn-subscribe-alt" href="./#events"><span>Back to events</span></a>');
      } catch (err) {
        show("That did not work", escapeHTML(err.message || "Try again in a minute."));
      }
    });
  });
}

const confirmToken = params.get("confirm");
const unsubscribeToken = params.get("unsubscribe");
if (confirmToken) confirm(confirmToken);
else if (unsubscribeToken) unsubscribe(unsubscribeToken);
else show("Email updates", "Subscribe from any event on the events page.", '<a class="btn-subscribe" href="./#events"><span>See the events</span></a>');
