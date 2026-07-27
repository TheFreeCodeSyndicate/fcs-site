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

// Section 4 reads repositories from this GitHub organization.
// The public GitHub API needs no key, but it has a rate limit.
const GITHUB_ORG = "TheFreeCodeSyndicate";

/*
 * Maintainers (Section 7).
 */
const MAINTAINERS = [
  {
    name: "Ronit Choudhury",
    username: "nonQualities",
    url: "https://github.com/nonQualities",
  },
  {
    name: "Jyotirmoy Das",
    username: "JyotirmoyDas05",
    url: "https://github.com/JyotirmoyDas05",
  },
  {
    name: "Ved Bhandary",
    username: "no3465",
    url: "https://github.com/no3465",
  },
];

/*
 * Operating protocol (Section 3).
 */
const PRINCIPLES = [
  {
    title: "Knowledge must stay copyable.",
    text: "If a thing is worth learning here, it must be possible to link it, copy it, read it, and improve it without private approval.",
  },
  {
    title: "The record matters.",
    text: "Good work leaves notes, commits, issues, examples, and failed attempts. The next person must not start in the dark.",
  },
  {
    title: "New learners are not exceptions.",
    text: "An explanation must serve the person who sees the subject for the first time. It must also respect the depth of the subject.",
  },
  {
    title: "Make small public things.",
    text: "A working demo, solved exercise, corrected README, or reviewed change has more value than a large private plan.",
  },
];

/*
 * Contribution lanes (Section 6).
 */
const CONTRIBUTION_LANES = [
  {
    label: "lane one",
    title: "Repair a weak point",
    text: "Improve a README, open a clear issue, add a missing example, or change a confusing setup step into a command that works.",
  },
  {
    label: "lane two",
    title: "Write a study note",
    text: "Record one idea, one fault, one small project, one paper, or one path from confusion to understanding.",
  },
  {
    label: "lane three",
    title: "Lead a study thread",
    text: "Choose a text, video, repository, or problem set. Set the pace, collect questions, and publish the useful result.",
  },
  {
    label: "lane four",
    title: "Build a common tool",
    text: "Make a small aid for the group: a template, script, reference page, visual note, or starter kit.",
  },
];

/*
 * Entry links (Section 8).
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
    hint: "Daily messages and notices.",
  },
  {
    label: "Discord Server",
    url: "https://discord.gg/nH2PRmbB5",
    hint: "Study rooms, voice rooms, and code help.",
  },
  {
    label: "GitHub Organization",
    url: "https://github.com/TheFreeCodeSyndicate",
    hint: "Public repositories and the work record.",
  },
];

/*
 * Study groups (Section 5).
 * Add a new group by copying an existing object below and editing
 * its fields. The order of this array is the order shown on the page.
 *
 *   name     - group name, shown as the card title
 *   topic    - one line describing what the group is doing
 *   status   - "Active" | "Forming" | "Paused" — shown as a small tag
 *   link     - where someone goes to enter the room
 *   linkText - label for that link, e.g. "Join on Discord"
 */
const STUDY_GROUPS = [
  {
    name: "Crypto Study Group",
    topic: "Study cryptography from first principles. Prove before you trust.",
    status: "Active",
    link: "https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP",
    linkText: "Check the repository",
  },
  {
    name: "Systems Reading Room",
    topic: "Read operating systems, networks, compilers, and the machine layer below user programs.",
    status: "Planned",
    link: "https://discord.gg/nH2PRmbB5",
    linkText: "Help form the room",
  },
  {
    name: "Anti Aliasing: A Computer Graphics Study Group",
    topic: "Study computer graphics from first principles. Learn to render, shade, and animate.",
    status: "Nascent",
    link: "https://github.com/TheFreeCodeSyndicate/anti-aliasing",
    linkText: "Read the repositories",
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
