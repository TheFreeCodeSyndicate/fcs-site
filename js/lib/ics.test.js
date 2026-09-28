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
    link: "https://discord.gg/97BAafVesn",
  },
];

test("emits a valid VCALENDAR envelope with CRLF line endings", () => {
  const ics = buildICS(EVENTS, { now: NOW });
  const lines = ics.split("\r\n");
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

test("UID is unique per event id", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("UID:abc-123@freecodesyndicate"));
});

test("folds long lines to 75 octets so clients accept them", () => {
  const ics = buildICS(
    [{ id: "long", title: "T".repeat(200), starts_at: "2026-10-05T18:30:00.000Z" }],
    { now: NOW }
  );
  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line.length}`);
  }
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
