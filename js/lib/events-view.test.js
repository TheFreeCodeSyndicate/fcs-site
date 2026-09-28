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

test("the input array is not mutated", () => {
  const input = [ev("b", "2026-10-01T18:00:00.000Z"), ev("a", "2026-10-08T18:00:00.000Z")];
  const snapshot = input.map((e) => e.id);
  partitionEvents(input, NOW);
  assert.deepEqual(input.map((e) => e.id), snapshot);
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
