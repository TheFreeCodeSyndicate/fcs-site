import { test } from "node:test";
import assert from "node:assert/strict";
import { buildICS } from "./ics.js";

const NOW = new Date("2026-09-28T00:00:00.000Z");

const EVENTS = [
  {
    id: "abc-123",
    title: "Explain-3 Session",
    details: "A study session; bring questions.",
    starts_at: "2026-10-05T18:30:00.000Z",
    duration_minutes: 90,
    group_name: "Crypto",
    link: "https://discord.gg/97BAafVesn",
  },
];

const only = (id, extra = {}) => [
  { id, title: id, starts_at: "2026-10-05T18:30:00.000Z", duration_minutes: 60, ...extra },
];

/** Every physical line, so a test can assert nothing is silently split. */
const physicalLines = (ics) => ics.split("\r\n");

/**
 * RFC 5545 folding: a CRLF plus one leading space is inserted at a fold
 * point. Removing it again reconstructs the original line. No other line
 * in these fixtures begins with a space, so this is exact.
 */
const unfolded = (ics) =>
  physicalLines(ics)
    .map((line, i) => (i === 0 ? line : line.replace(/^ /, "")))
    .join("");

const assertNoLineOver75Octets = (ics) => {
  for (const line of physicalLines(ics)) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${JSON.stringify(line)}`);
  }
};

/**
 * The physical lines one property occupies: the `NAME:value` line plus
 * every folded continuation, each of which starts with the single space
 * RFC 5545 inserts at the fold point.
 */
const propertyLines = (ics, name) => {
  const lines = physicalLines(ics);
  const first = lines.findIndex((line) => line.startsWith(`${name}:`));
  if (first === -1) return [];
  const out = [lines[first]];
  for (let i = first + 1; i < lines.length && lines[i].startsWith(" "); i++) out.push(lines[i]);
  return out;
};

test("emits a valid VCALENDAR envelope with CRLF line endings", () => {
  const ics = buildICS(EVENTS, { now: NOW });
  const lines = physicalLines(ics);
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines[lines.length - 1], "END:VCALENDAR");
  assert.ok(lines.includes("VERSION:2.0"));
});

test("converts a timestamp to a UTC DTSTART with a Z suffix", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("DTSTART:20261005T183000Z"));
});

test("DTEND reflects duration_minutes", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("DTEND:20261005T200000Z"));
});

test("DTEND defaults to 60 minutes when duration is missing", () => {
  const ics = buildICS([{ id: "x", title: "No Duration", starts_at: "2026-10-05T18:30:00.000Z" }], {
    now: NOW,
  });
  assert.ok(ics.includes("DTEND:20261005T193000Z"));
});

test("escapes commas, semicolons, backslashes and newlines in text", () => {
  const ics = buildICS(
    [{ id: "e", title: "A, B; C \\ D\nline two", starts_at: "2026-10-05T18:30:00.000Z" }],
    { now: NOW }
  );
  assert.ok(ics.includes("SUMMARY:A\\, B\\; C \\\\ D\\nline two"), ics);
});

test("a lone carriage return is escaped like any other line break", () => {
  const ics = buildICS(
    [{ id: "e", title: "A\rB\rC", starts_at: "2026-10-05T18:30:00.000Z" }],
    { now: NOW }
  );
  assert.ok(ics.includes("SUMMARY:A\\nB\\nC"), ics);
  assert.equal(physicalLines(ics).filter((l) => l.startsWith("SUMMARY:")).length, 1);
});

test("UID is unique per event id", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("UID:abc-123@freecodesyndicate"));
});

test("DTSTAMP is the injected now, in UTC", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("DTSTAMP:20260928T000000Z"));
});

test("DTSTAMP is identical on every VEVENT", () => {
  const ics = buildICS(
    [
      { id: "a", title: "A", starts_at: "2026-10-05T18:30:00.000Z" },
      { id: "b", title: "B", starts_at: "2026-10-06T18:30:00.000Z" },
    ],
    { now: NOW }
  );
  const stamps = physicalLines(ics).filter((l) => l.startsWith("DTSTAMP:"));
  assert.equal(stamps.length, 2);
  assert.equal(new Set(stamps).size, 1);
});

test("an unusable now falls back to the current time instead of throwing", () => {
  const ics = buildICS([{ id: "x", title: "T", starts_at: "2026-10-05T18:30:00.000Z" }], {
    now: new Date("bogus"),
  });
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
});

test("DESCRIPTION and CATEGORIES are emitted and escaped", () => {
  const lines = physicalLines(buildICS(EVENTS, { now: NOW }));
  assert.ok(lines.includes("DESCRIPTION:A study session\\; bring questions."), lines.join("\n"));
  assert.ok(lines.includes("CATEGORIES:Crypto"));
});

test("DESCRIPTION and CATEGORIES are omitted when absent or blank", () => {
  const ics = buildICS([{ id: "x", title: "T", starts_at: "2026-10-05T18:30:00.000Z" }], {
    now: NOW,
  });
  assert.ok(!ics.includes("DESCRIPTION:"));
  assert.ok(!ics.includes("CATEGORIES:"));
});

test("URL is emitted verbatim for a well formed link", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("URL:https://discord.gg/97BAafVesn"));
});

test("URL is omitted when there is no link", () => {
  const ics = buildICS([{ id: "x", title: "T", starts_at: "2026-10-05T18:30:00.000Z" }], {
    now: NOW,
  });
  assert.ok(!ics.includes("URL:"));
});

test("a line break in a URL cannot inject a second property", () => {
  const ics = buildICS(
    only("inject", { link: "https://x.test/a\r\nSUMMARY:Injected\r\nATTENDEE:evil" }),
    { now: NOW }
  );
  const lines = physicalLines(ics);
  assert.equal(lines.filter((l) => l.startsWith("URL:")).length, 1);
  assert.equal(lines.filter((l) => l.startsWith("SUMMARY:")).length, 1);
  assert.ok(!lines.includes("ATTENDEE:evil"));
  assert.ok(lines.includes("URL:https://x.test/aSUMMARY:InjectedATTENDEE:evil"), lines.join("\n"));
});

test("a link is trimmed", () => {
  const ics = buildICS(only("trim", { link: "  https://x.test/b  " }), { now: NOW });
  assert.ok(ics.includes("URL:https://x.test/b"), ics);
});

test("the calendar name defaults and can be overridden and escaped", () => {
  assert.ok(buildICS([], { now: NOW }).includes("X-WR-CALNAME:FCS Events"));
  const ics = buildICS([], { now: NOW, calendarName: "FCS, Events; 2026\nCohort" });
  assert.ok(ics.includes("X-WR-CALNAME:FCS\\, Events\\; 2026\\nCohort"), ics);
  assert.equal(physicalLines(ics).filter((l) => l.startsWith("X-WR-CALNAME:")).length, 1);
});

test("a duration large enough to overflow the Date range falls back to 60 minutes", () => {
  const ics = buildICS(only("overflow", { duration_minutes: 1e21 }), { now: NOW });
  assert.ok(ics.includes("DTEND:20261005T193000Z"), ics);
});

test("the duration fallback is shared with the public page", () => {
  // 0, negative, NaN, null, undefined and a valid value. The calendar and
  // the rendered page must agree on the end time for every one of them.
  const cases = [
    [90, "DTEND:20261005T200000Z"],
    [0, "DTEND:20261005T193000Z"],
    [-30, "DTEND:20261005T193000Z"],
    [NaN, "DTEND:20261005T193000Z"],
    [null, "DTEND:20261005T193000Z"],
    [undefined, "DTEND:20261005T193000Z"],
  ];
  for (const [duration_minutes, expected] of cases) {
    const ics = buildICS(only("d", { duration_minutes }), { now: NOW });
    assert.ok(ics.includes(expected), `duration ${duration_minutes}: ${ics}`);
  }
});

test("folds long lines to 75 octets so clients accept them", () => {
  const ics = buildICS(
    [{ id: "long", title: "T".repeat(200), starts_at: "2026-10-05T18:30:00.000Z" }],
    { now: NOW }
  );
  assertNoLineOver75Octets(ics);
  assert.ok(unfolded(ics).includes(`SUMMARY:${"T".repeat(200)}`));
});

test("folds at the exact 74 and 75 octet boundary", () => {
  // "SUMMARY:" is 8 octets, so these lines are 74, 75 and 76.
  for (const [length, expectFolded] of [
    [66, false],
    [67, false],
    [68, true],
  ]) {
    const title = "T".repeat(length);
    const ics = buildICS([{ id: "edge", title, starts_at: "2026-10-05T18:30:00.000Z" }], {
      now: NOW,
    });
    assertNoLineOver75Octets(ics);
    const summary = propertyLines(ics, "SUMMARY");
    assert.equal(summary.length > 1, expectFolded, `length ${length}: ${ics}`);
    if (expectFolded) assert.equal(Buffer.byteLength(summary[0], "utf8"), 75);
    assert.ok(unfolded(ics).includes(`SUMMARY:${title}`), `length ${length} did not round-trip`);
  }
});

test("folds multi-octet text without splitting a character", () => {
  // 2-, 3- and 4-octet characters: the budget is counted in octets, and a
  // fold may not land in the middle of a code point.
  for (const [label, char] of [
    ["2-octet", "é"],
    ["3-octet", "日"],
    ["4-octet", "🎉"],
  ]) {
    const title = char.repeat(40);
    const ics = buildICS([{ id: "mb", title, starts_at: "2026-10-05T18:30:00.000Z" }], {
      now: NOW,
    });
    assertNoLineOver75Octets(ics);
    assert.ok(
      unfolded(ics).includes(`SUMMARY:${title}`),
      `${label} characters were split or lost: ${ics}`
    );
  }
});

test("a whole calendar of multi-octet text stays within the octet budget", () => {
  const ics = buildICS(
    [
      {
        id: "mb",
        title: "🎉 " + "日".repeat(60),
        details: "é".repeat(120),
        starts_at: "2026-10-05T18:30:00.000Z",
        group_name: "日".repeat(40),
      },
    ],
    { now: NOW }
  );
  assertNoLineOver75Octets(ics);
});

test("an empty event list still yields a valid calendar", () => {
  const ics = buildICS([], { now: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});

test("rows with no usable start time are skipped, not emitted broken", () => {
  const ics = buildICS([{ id: "bad", title: "No Date" }], { now: NOW });
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});
