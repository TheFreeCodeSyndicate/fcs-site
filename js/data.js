/*
 * js/data.js
 * ------------------------------------------------------------------
 * PRINCIPLES, CONTRIBUTION_LANES and MAINTAINERS are fixed page copy
 * and live here permanently.
 *
 * The SEED_* arrays are a FALLBACK used only when Supabase is
 * unreachable or unconfigured. They are not the source of truth any
 * more — the database is. Edit content in the admin panel at /admin,
 * not in this file.
 * ------------------------------------------------------------------
 */

// Section 4 reads repositories from this GitHub organization.
// The public GitHub API needs no key, but it has a rate limit.
const GITHUB_ORG = "TheFreeCodeSyndicate";

/*
 * Maintainers (Section 9).
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
 * Contribution lanes (Section 8).
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
 * Entry links (Section 10) — fallback for the `social_links` table.
 *
 *   platform - the tag shown in References, e.g. "DISCORD"
 *   label    - text on the card
 *   url      - where the card links to
 *   hint     - short line under the label, e.g. what to expect there
 */
const SEED_JOIN_LINKS = [
  {
    platform: "discord",
    label: "Discord Server",
    url: "https://discord.gg/97BAafVesn",
    hint: "Study rooms, voice rooms, and code help.",
  },
  {
    platform: "instagram",
    label: "Instagram",
    url: "https://www.instagram.com/freecodesyndicate/",
    hint: "Posters, notes, and session announcements.",
  },
  {
    platform: "whatsapp",
    label: "WhatsApp Community",
    url: "https://chat.whatsapp.com/Dks4VUe0E5n7xmilaKTqXS",
    hint: "Daily messages and notices.",
  },
  {
    platform: "github",
    label: "GitHub Organization",
    url: "https://github.com/TheFreeCodeSyndicate",
    hint: "Public repositories and the work record.",
  },
];

/*
 * Study groups (Section 6) — fallback for the `study_groups` table.
 * Column names mirror that table exactly. The order of this array is
 * the order shown on the page.
 *
 *   name      - group name, shown as the card title
 *   topic     - one line describing what the group is doing
 *   status    - "Active" | "Forming" | "Paused" | "Completed" — shown as a small tag
 *   link      - where someone goes to enter the room
 *   link_text - label for that link, e.g. "Join on Discord"
 */
const SEED_STUDY_GROUPS = [
  {
    name: "Crypto Study Group",
    topic: "Study cryptography from first principles. Prove before you trust.",
    status: "Completed",
    link: "https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP",
    link_text: "Check the repository",
  },
  {
    name: "Systems Reading Room",
    topic: "Read operating systems, networks, compilers, and the machine layer below user programs.",
    status: "Forming",
    link: "https://discord.gg/97BAafVesn",
    link_text: "Help form the room",
  },
  {
    name: "Anti Aliasing: A Computer Graphics Study Group",
    topic: "Study computer graphics from first principles. Learn to render, shade, and animate.",
    status: "Forming",
    link: "https://github.com/TheFreeCodeSyndicate/anti-aliasing",
    link_text: "Read the repositories",
  },
];

/*
 * Events (Section 7) — fallback for the `events` table. Column names
 * mirror that table exactly, so a seeded row is indistinguishable from
 * a stored one. The order of this array is the order shown on the page.
 *
 *   id                - stable identifier; the .ics UID is built from it
 *   title             - event name, shown as the card title
 *   group_name        - study group, chapter, or room running the event
 *   details           - one line describing what will happen
 *   starts_at         - ISO 8601 timestamp, always with a Z offset
 *   duration_minutes  - how long it runs; the clock derives "live" from this
 *   stage             - "draft" | "scheduled" | "live" | "done".
 *                       Only "done" is fixed by hand; every other value is
 *                       judged against the clock. Drafts are never shown.
 *   link              - optional event/repository/community link
 *   link_text         - label for that link
 */
const SEED_EVENTS = [
  {
    id: "seed-explain-3",
    title: "Explain-3 Session",
    group_name: "Crypto Study Group",
    details: "A study session for the next Explain track discussion.",
    starts_at: "2026-07-28T15:30:00.000Z",
    duration_minutes: 60,
    stage: "done",
    link: "https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP",
    link_text: "Check the repository",
  },
  {
    id: "seed-cryptomeet-3",
    title: "CryptoMeet-3 Session",
    group_name: "Crypto Study Group",
    details: "A meeting for discussing the PCSP project, DES and AES, and some public key cryptography.",
    starts_at: "2026-08-04T15:30:00.000Z",
    duration_minutes: 60,
    stage: "done",
    link: "https://discord.gg/97BAafVesn",
    link_text: "Join Discord",
  },
  {
    id: "seed-pqc",
    title: "Quantum Computing and PQC Session",
    group_name: "Crypto Study Group",
    details: "A meeting for discussing quantum computing and post-quantum cryptography.",
    starts_at: "2026-08-09T15:30:00.000Z",
    duration_minutes: 60,
    stage: "done",
    link: "https://calendar.app.google/4agDYABbWPYyvWQc9",
    link_text: "Add to Calendar",
  },
];

/*
 * Resources (Section 5) — fallback for the `resources` table.
 * Distinct from Projects, which is the live GitHub list.
 *
 *   title      - the card title
 *   kind       - "notes" | "video" | "paper" | "course" | "tool" | "book"
 *   url        - where it lives
 *   summary    - one line describing it
 *   group_name - study group it belongs to, or null
 */
const SEED_RESOURCES = [
  {
    title: "CRYPTO_STUDY_GROUP",
    kind: "notes",
    url: "https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP",
    summary: "Public study notes and exercises from the crypto track.",
    group_name: "Crypto Study Group",
  },
];

/*
 * Repo kinds — repos a maintainer has curated as Resources rather than
 * Projects. Empty in the seed data: a new repository appears as a
 * Project on its own, with no CMS involvement.
 */
const SEED_REPO_KINDS = [];

/* data.js is a CLASSIC script, so its top-level `const`s live in the
   global lexical environment — which a module (main.js) can NOT read.
   Everything main.js needs must be published on `window` explicitly. */
window.PRINCIPLES = PRINCIPLES;
window.CONTRIBUTION_LANES = CONTRIBUTION_LANES;
window.MAINTAINERS = MAINTAINERS;
window.GITHUB_ORG = GITHUB_ORG;
window.SEED_EVENTS = SEED_EVENTS;
window.SEED_STUDY_GROUPS = SEED_STUDY_GROUPS;
window.SEED_JOIN_LINKS = SEED_JOIN_LINKS;
window.SEED_RESOURCES = SEED_RESOURCES;
window.SEED_REPO_KINDS = SEED_REPO_KINDS;
