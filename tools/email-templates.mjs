// Branded Supabase Auth emails.
//
//   node tools/email-templates.mjs          writes supabase/email/*.html
//   node tools/email-templates.mjs --push   also uploads them to the project
//
// --push needs SUPABASE_ACCESS_TOKEN (a personal access token from
// https://supabase.com/dashboard/account/tokens) in the environment.
// The {{ ... }} parts are Go template tags that Supabase fills in when it sends.

import { mkdirSync, writeFileSync } from "node:fs";

const PROJECT_REF = "odkpecmcvzjakeavaqcf";
const SITE = "https://thefreecodesyndicate.github.io/fcs-site/";
const LOGO = `${SITE}assets/favicon-192.png`;

const INK = "#0a0a0a";
const PAPER = "#faf8f2";
const BG = "#f3f0e6";
const ACCENT = "#ffc72c";
const MUTED = "#55524a";
const HEAD = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const BODY = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

const p = (html) =>
  `<p style="margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:1.55;color:${INK};">${html}</p>`;

const button = (label, href = "{{ .ConfirmationURL }}") => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td style="background:${INK};padding:0 4px 4px 0;">
    <a href="${href}" style="display:block;background:${ACCENT};border:3px solid ${INK};padding:14px 26px;font-family:${HEAD};font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:${INK};text-decoration:none;">${label} &rarr;</a>
  </td></tr>
</table>`;

// Shown under the button for mail apps that strip links from buttons.
const fallback = (href = "{{ .ConfirmationURL }}") => `
<p style="margin:0 0 8px;font-family:${BODY};font-size:13px;color:${MUTED};">Button not working? Paste this into your browser:</p>
<p style="margin:0 0 20px;font-family:${MONO};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${href}" style="color:${INK};">${href}</a></p>`;

const code = (value) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
  <tr><td style="background:${INK};padding:0 4px 4px 0;">
    <div style="background:${ACCENT};border:3px solid ${INK};padding:14px 28px;font-family:${MONO};font-size:32px;font-weight:bold;letter-spacing:10px;color:${INK};">${value}</div>
  </td></tr>
</table>`;

const steps = (items) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:2px solid ${INK};">
  ${items.map((text, i) => `<tr>
    <td width="44" valign="top" style="background:${i === 0 ? ACCENT : PAPER};border-bottom:${i < items.length - 1 ? `2px solid ${INK}` : "0"};border-right:2px solid ${INK};padding:12px 0;text-align:center;font-family:${HEAD};font-size:15px;color:${INK};">${i + 1}</td>
    <td style="border-bottom:${i < items.length - 1 ? `2px solid ${INK}` : "0"};padding:12px 14px;font-family:${BODY};font-size:14px;line-height:1.45;color:${INK};">${text}</td>
  </tr>`).join("")}
</table>`;

const note = (html) =>
  `<p style="margin:0;padding:12px 14px;border-left:4px solid ${INK};background:${BG};font-family:${BODY};font-size:13px;line-height:1.5;color:${MUTED};">${html}</p>`;

function layout({ preheader, tag, title, body, why }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="background:${INK};padding:0 6px 6px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};border:3px solid ${INK};">
          <tr><td style="background:${ACCENT};border-bottom:3px solid ${INK};padding:16px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td width="44" valign="middle"><img src="${LOGO}" width="36" height="36" alt="" style="display:block;border:2px solid ${INK};"></td>
              <td valign="middle" style="font-family:${HEAD};font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:${INK};">The Free Code Syndicate</td>
              <td valign="middle" align="right" style="font-family:${MONO};font-size:12px;font-weight:bold;white-space:nowrap;color:${INK};">${tag}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:32px 28px 28px;">
            <h1 style="margin:0 0 18px;font-family:${HEAD};font-size:26px;line-height:1.2;color:${INK};">${title}</h1>
            ${body}
          </td></tr>
          <tr><td style="border-top:3px solid ${INK};padding:16px 28px;font-family:${MONO};font-size:12px;line-height:1.6;color:${MUTED};">
            ${why}<br>
            <a href="${SITE}" style="color:${INK};font-weight:bold;">thefreecodesyndicate.github.io/fcs-site</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`;
}

const ROLE = `{{ if eq .Data.invited_role "admin" }}Admin{{ else }}Editor{{ end }}`;
const IGNORE = "If you didn't ask for this, ignore this email. Nothing changes until the link is used.";
const ALERT = "If this wasn't you, reset your password straight away from the sign-in page, and tell an admin.";

// key: the Management API's name for the template.
const TEMPLATES = [
  {
    key: "invite",
    subject: `You're invited to the FCS admin panel as ${ROLE}`,
    preheader: `Accept the invite, choose a password, then sign in as ${ROLE}.`,
    tag: "// INVITE",
    title: "You're invited to the admin panel",
    body:
      p(`{{ if .Data.invited_by }}<strong>{{ .Data.invited_by }}</strong> has{{ else }}You've been{{ end }} invited you to help run The Free Code Syndicate's website as <strong style="background:${ACCENT};padding:1px 6px;border:2px solid ${INK};">${ROLE}</strong>.`) +
      p(`{{ if eq .Data.invited_role "admin" }}Admins edit everything on the site, delete and restore content, and manage who else has access.{{ else }}Editors add and update events, the class schedule, core members, study groups, resources and links.{{ end }}`) +
      steps([
        "<strong>Accept the invite</strong> with the button below.",
        "<strong>Choose your password</strong> and type it twice to confirm.",
        "<strong>Sign in</strong> with <strong>{{ .Email }}</strong> and your new password. That's how you'll get in from then on.",
      ]) +
      button("Accept invite") +
      fallback() +
      note("The link works once and expires after a while. If it has expired, ask an admin to send a new invite."),
    why: "You got this because an admin invited {{ .Email }}.",
  },
  {
    key: "recovery",
    subject: "Reset your FCS admin password",
    preheader: "Choose a new password for the FCS admin panel.",
    tag: "// RESET",
    title: "Reset your password",
    body:
      p("Someone asked to reset the password for <strong>{{ .Email }}</strong> on the FCS admin panel. Choose a new one below, then sign in with it.") +
      button("Choose a new password") +
      fallback() +
      note(`The link works once and expires soon. ${IGNORE}`),
    why: "You got this because a password reset was requested for {{ .Email }}.",
  },
  {
    key: "password_changed_notification",
    notification: true,
    subject: "Your FCS admin password was changed",
    preheader: "The password on your FCS admin account was just changed.",
    tag: "// SECURITY",
    title: "Your password was changed",
    body:
      p("The password for <strong>{{ .Email }}</strong> on the FCS admin panel was just changed. If that was you, there's nothing to do.") +
      button("Go to sign in", `${SITE}admin.html`) +
      note(ALERT),
    why: "Security notice for {{ .Email }}. These are sent whenever the password changes.",
  },
  {
    key: "email_changed_notification",
    notification: true,
    subject: "Your FCS admin email address was changed",
    preheader: "The sign-in email on your FCS admin account was changed.",
    tag: "// SECURITY",
    title: "Your email address was changed",
    body:
      p("The sign-in email for your FCS admin account changed from <strong>{{ .OldEmail }}</strong> to <strong>{{ .Email }}</strong>.") +
      note("If this wasn't you, tell an admin straight away so they can lock the account."),
    why: "Security notice sent to the old and new address.",
  },
  {
    key: "confirmation",
    subject: "Confirm your email for the FCS admin panel",
    preheader: "Confirm your email, then wait for an admin to approve you.",
    tag: "// CONFIRM",
    title: "Confirm your email",
    body:
      p("Thanks for signing up to the FCS admin panel with <strong>{{ .Email }}</strong>. Confirm the address below.") +
      button("Confirm email") +
      fallback() +
      note(`New accounts have no access until an admin approves them on the Team page. ${IGNORE}`),
    why: "You got this because someone signed up with {{ .Email }}.",
  },
  {
    key: "magic_link",
    subject: "Your FCS admin sign-in link",
    preheader: "One click to sign in to the FCS admin panel.",
    tag: "// SIGN IN",
    title: "Your sign-in link",
    body:
      p("Use the button to sign in to the FCS admin panel as <strong>{{ .Email }}</strong>. Or enter this code:") +
      code("{{ .Token }}") +
      button("Sign in") +
      fallback() +
      note(`The link and code work once and expire soon. ${IGNORE}`),
    why: "You got this because a sign-in link was requested for {{ .Email }}.",
  },
  {
    key: "email_change",
    subject: "Confirm your new FCS admin email address",
    preheader: "Confirm the new sign-in email for your FCS admin account.",
    tag: "// EMAIL",
    title: "Confirm your new email",
    body:
      p("Confirm that <strong>{{ .NewEmail }}</strong> should replace <strong>{{ .Email }}</strong> as the sign-in email for your FCS admin account.") +
      button("Confirm new email") +
      fallback() +
      note(`Until you confirm, you keep signing in with {{ .Email }}. ${IGNORE}`),
    why: "You got this because an email change was requested for {{ .Email }}.",
  },
  {
    key: "reauthentication",
    subject: "{{ .Token }} is your FCS verification code",
    preheader: "Your FCS admin verification code.",
    tag: "// VERIFY",
    title: "Your verification code",
    body:
      p("Enter this code to confirm it's you before a sensitive change on the FCS admin panel:") +
      code("{{ .Token }}") +
      note(`The code expires shortly. ${ALERT}`),
    why: "You got this because a verification code was requested for {{ .Email }}.",
  },
];

mkdirSync("supabase/email", { recursive: true });
const config = {};
for (const t of TEMPLATES) {
  const html = layout(t);
  writeFileSync(`supabase/email/${t.key}.html`, html);
  const kind = t.notification ? t.key.replace(/_notification$/, "") : null;
  config[`mailer_subjects_${t.key}`] = t.subject;
  config[`mailer_templates_${t.key}_content`] = html;
  if (kind) config[`mailer_notifications_${kind}_enabled`] = true;
}
console.log(`Wrote ${TEMPLATES.length} templates to supabase/email/`);

if (process.argv.includes("--push")) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("Set SUPABASE_ACCESS_TOKEN first (https://supabase.com/dashboard/account/tokens).");
    process.exit(1);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    console.error(`Supabase said ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log("Pushed subjects, templates and security notifications to Supabase.");
}
