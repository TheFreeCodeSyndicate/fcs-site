import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionEvents, groupNames, filterByGroup } from "./events-view.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");

const ev = (id, starts_at, extra = {}) => ({
  id,
  title: id,
  starts_at,
  duration_minutes: 60,
  stage: "scheduled",
  group_name: "Crypto",
  ...extra,
});

test("upcoming sorts ascending and past sorts descending", () => {
  const { upcoming, past } = partitionEvents(
    [
      ev("middle", "2026-10-07T18:00:00.000Z"),
      ev("latest", "2026-10-09T18:00:00.000Z"),
      ev("recent-past", "2026-10-06T18:00:00.000Z"),
      ev("old-past", "2026-09-01T18:00:00.000Z"),
    ],
    NOW
  );
  assert.deepEqual(upcoming.map((e) => e.id), ["middle", "latest"]);
  assert.deepEqual(past.map((e) => e.id), ["recent-past", "old-past"]);
});

test("each event carries its derived display state", () => {
  const { upcoming, past } = partitionEvents(
    [ev("soon", "2026-10-07T18:00:00.000Z"), ev("ago", "2026-10-01T18:00:00.000Z")],
    NOW
  );
  assert.equal(upcoming[0].display_state, "upcoming");
  assert.equal(past[0].display_state, "finished");
});

test("a currently running event is live and lands in upcoming", () => {
  const { upcoming, past } = partitionEvents(
    [ev("running", "2026-10-07T12:00:00.000Z")],
    NOW
  );
  assert.equal(upcoming[0].display_state, "live");
  assert.equal(past.length, 0);
});

test("a cancelled future event lands in past because it is done", () => {
  const { upcoming, past } = partitionEvents(
    [ev("cancelled", "2026-11-01T18:00:00.000Z", { stage: "done" })],
    NOW
  );
  assert.equal(upcoming.length, 0);
  assert.equal(past[0].id, "cancelled");
});

test("a draft is hidden from the public page in both lists", () => {
  const { upcoming, past } = partitionEvents(
    [
      ev("draft-future", "2026-11-01T18:00:00.000Z", { stage: "draft" }),
      ev("draft-old", "2026-01-01T18:00:00.000Z", { stage: "draft" }),
    ],
    NOW
  );
  assert.deepEqual(upcoming, []);
  assert.deepEqual(past, []);
});

test("a draft is dropped but its published siblings survive", () => {
  const { upcoming, past } = partitionEvents(
    [
      ev("draft", "2026-11-01T18:00:00.000Z", { stage: "draft" }),
      ev("published", "2026-11-02T18:00:00.000Z"),
    ],
    NOW
  );
  assert.deepEqual(upcoming.map((e) => e.id), ["published"]);
  assert.deepEqual(past, []);
});

test("a row with an unparseable start sorts last in both lists", () => {
  const { upcoming, past } = partitionEvents(
    [
      ev("broken", "not-a-date"),
      ev("later", "2026-10-09T18:00:00.000Z"),
      ev("sooner", "2026-10-08T18:00:00.000Z"),
      ev("old-broken", "also-not-a-date"),
      ev("recent-past", "2026-10-06T18:00:00.000Z"),
      ev("broken-past", "still-not-a-date", { stage: "done" }),
    ],
    NOW
  );
  // An unparseable start derives to "upcoming", so it competes with the
  // upcoming list, and it goes after every row that has a real time.
  assert.deepEqual(upcoming.map((e) => e.id), ["sooner", "later", "broken", "old-broken"]);
  // `stage: "done"` short-circuits the clock, so a broken row can reach
  // the Past list. It must not lead it, in either sort direction.
  assert.deepEqual(past.map((e) => e.id), ["recent-past", "broken-past"]);
});

test("two unparseable rows keep a stable relative order", () => {
  const rows = [ev("first", "nope"), ev("second", "also-nope")];
  const { upcoming } = partitionEvents(rows, NOW);
  assert.deepEqual(upcoming.map((e) => e.id), ["first", "second"]);
  const again = partitionEvents([...rows].reverse(), NOW);
  assert.deepEqual(again.upcoming.map((e) => e.id), ["second", "first"]);
});

test("the input events are not mutated", () => {
  const input = [ev("b", "2026-10-01T18:00:00.000Z"), ev("a", "2026-10-08T18:00:00.000Z")];
  const snapshot = structuredClone(input);
  const { upcoming, past } = partitionEvents(input, NOW);
  assert.deepEqual(input, snapshot);
  // And the returned rows are copies, so writing to one cannot reach back.
  assert.notEqual(upcoming[0], input[1]);
  upcoming[0].title = "renamed";
  assert.equal(input[1].title, "a");
  assert.equal(past[0].title, "b");
});

test("group names are unique, non-empty, and sorted", () => {
  const names = groupNames([
    { group_name: "Crypto" },
    { group_name: "Graphics" },
    { group_name: "Crypto" },
    { group_name: null },
    { group_name: "" },
    { group_name: "   " },
  ]);
  assert.deepEqual(names, ["Crypto", "Graphics"]);
});

test("filtering by group keeps only that group", () => {
  const items = [
    ev("a", "2026-10-08T18:00:00.000Z"),
    ev("b", "2026-10-08T18:00:00.000Z", { group_name: "Graphics" }),
  ];
  assert.deepEqual(filterByGroup(items, "Graphics").map((e) => e.id), ["b"]);
});

test("filtering by All returns everything", () => {
  const items = [
    ev("a", "2026-10-08T18:00:00.000Z"),
    ev("b", "2026-10-08T18:00:00.000Z", { group_name: "Graphics" }),
  ];
  assert.equal(filterByGroup(items, "All").length, 2);
});

test("a padded group name produces a chip that actually filters", () => {
  const items = [
    ev("a", "2026-10-08T18:00:00.000Z", { group_name: "  Crypto  " }),
    ev("b", "2026-10-08T18:00:00.000Z", { group_name: "Graphics" }),
  ];
  // The chip is built from the trimmed name...
  assert.deepEqual(groupNames(items), ["Crypto", "Graphics"]);
  // ...and has to match the untrimmed stored value.
  assert.deepEqual(filterByGroup(items, "Crypto").map((e) => e.id), ["a"]);
});

test("filtering by a group name also accepts the padded stored form", () => {
  const items = [ev("a", "2026-10-08T18:00:00.000Z", { group_name: "  Crypto  " })];
  assert.equal(filterByGroup(items, "  Crypto  ").length, 1);
});

test("a blank or absent group filter does not filter", () => {
  const items = [ev("a", "2026-10-08T18:00:00.000Z", { group_name: "Crypto" })];
  assert.equal(filterByGroup(items, "").length, 1);
  assert.equal(filterByGroup(items, "   ").length, 1);
  assert.equal(filterByGroup(items, undefined).length, 1);
});

test("a row with no group name never matches a group filter", () => {
  const items = [ev("a", "2026-10-08T18:00:00.000Z", { group_name: null })];
  assert.deepEqual(filterByGroup(items, "null"), []);
});
