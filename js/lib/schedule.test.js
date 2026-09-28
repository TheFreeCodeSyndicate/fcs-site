import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, resolveNextSession } from "./schedule.js";

const at = (iso) => new Date(iso);

test("returns the next matching weekday later the same day", () => {
  const next = nextOccurrence(
    { weekday: 3, start_time: "21:00", is_active: true },
    at("2026-10-07T09:00:00")
  );
  assert.equal(next.getHours(), 21);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getDate(), 7);
});

test("rolls to next week when today's slot has passed", () => {
  const next = nextOccurrence(
    { weekday: 3, start_time: "21:00", is_active: true },
    at("2026-10-07T23:00:00")
  );
  assert.equal(next.getDay(), 3);
  assert.equal(next.getDate(), 14);
});

test("weekday 0 is Sunday, matching Date.getDay()", () => {
  const next = nextOccurrence(
    { weekday: 0, start_time: "10:00", is_active: true },
    at("2026-10-05T12:00:00")
  );
  assert.equal(next.getDay(), 0);
});

test("inactive sessions have no next occurrence", () => {
  assert.equal(
    nextOccurrence({ weekday: 1, start_time: "10:00", is_active: false }, at("2026-10-05T12:00:00")),
    null
  );
});

test("a malformed start_time yields null rather than an Invalid Date", () => {
  assert.equal(
    nextOccurrence({ weekday: 1, start_time: "", is_active: true }, at("2026-10-05T12:00:00")),
    null
  );
});

test("resolveNextSession picks the soonest of events and classes", () => {
  const result = resolveNextSession(
    {
      events: [
        { id: "e-far", title: "Far Event", starts_at: "2026-10-20T18:30:00.000Z", stage: "scheduled" },
        { id: "e-near", title: "Near Event", starts_at: "2026-10-06T18:30:00.000Z", stage: "scheduled" },
        { id: "e-past", title: "Past Event", starts_at: "2026-10-01T18:30:00.000Z", stage: "scheduled" },
        { id: "e-done", title: "Done Event", starts_at: "2026-10-02T18:30:00.000Z", stage: "done" },
      ],
      classSessions: [
        { title: "Weekly Class", group_name: "Crypto", weekday: 4, start_time: "21:00", is_active: true },
      ],
    },
    at("2026-10-05T12:00:00")
  );
  assert.equal(result.title, "Near Event");
  assert.equal(result.kind, "event");
});

test("resolveNextSession falls back to a class when no event is pending", () => {
  const result = resolveNextSession(
    {
      events: [],
      classSessions: [{ title: "Weekly Class", weekday: 2, start_time: "21:00", is_active: true }],
    },
    at("2026-10-05T12:00:00")
  );
  assert.equal(result.title, "Weekly Class");
  assert.equal(result.kind, "class");
});

test("resolveNextSession returns null when there is nothing ahead", () => {
  assert.equal(resolveNextSession({ events: [], classSessions: [] }, at("2026-10-05T12:00:00")), null);
});

test("resolveNextSession tolerates being called with no arguments", () => {
  assert.equal(typeof resolveNextSession(), "object");
});
