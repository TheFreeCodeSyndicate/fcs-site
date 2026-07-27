/*
 * js/data.js
 * ------------------------------------------------------------------
 * All the content that changes over time lives in this file.
 * To update the site — add a study group, change a link, point the
 * repo list at a different org — edit this file only. You should not
 * need to touch index.html, style.css, or main.js for routine
 * updates.
 * ------------------------------------------------------------------
 */

// The GitHub organization Section 2 ("Repositories") pulls from.
// Uses the public, unauthenticated GitHub API — no key required,
// but GitHub limits unauthenticated requests to 60/hour per visitor.
const GITHUB_ORG = "TheFreeCodeSyndicate";

/*
 * Community links (Section 4, "How to Join").
 * Add or remove an entry to add or remove a card on the page.
 *
 *   label - text on the card
 *   url   - where the card links to
 *   hint  - short line under the label, e.g. what to expect there
 */
const JOIN_LINKS = [
  {
    label: "WhatsApp Community",
    url: "https://chat.whatsapp.com/Dks4VUe0E5n7xmilaKTqXS",
    hint: "Day-to-day chat and announcements.",
  },
  {
    label: "Discord Server",
    url: "https://discord.gg/nH2PRmbB5",
    hint: "Study group channels, voice rooms, code help.",
  },
  {
    label: "GitHub Organization",
    url: "https://github.com/TheFreeCodeSyndicate",
    hint: "Every repository we maintain, in one place.",
  },
];

/*
 * Study groups (Section 3).
 * Add a new group by copying an existing object below and editing
 * its fields. The order of this array is the order shown on the page.
 *
 *   name     - group name, shown as the card title
 *   topic    - one line describing what the group is doing
 *   status   - "Active" | "Forming" | "Paused" — shown as a small tag
 *   link     - where someone goes to join (a Discord channel, etc.)
 *   linkText - label for that link, e.g. "Join on Discord"
 */
const STUDY_GROUPS = [
  {
    name: "Crypto Study Group",
    topic: "Learning cryptography from scratch, from first principles up.",
    status: "Active",
    link: "https://discord.gg/nH2PRmbB5",
    linkText: "Join on Discord",
  },

  // Add the next group by copying the block below and filling it in:
  // {
  //   name: "Group Name",
  //   topic: "One line on what you're studying.",
  //   status: "Forming",
  //   link: "https://discord.gg/nH2PRmbB5",
  //   linkText: "Join on Discord",
  // },
];
