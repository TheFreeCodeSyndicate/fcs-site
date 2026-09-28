import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveEventState, resolveDurationMinutes, LIVE_LEAD_MINUTES } from "./derive.js";

const START = "2026-10-05T18:30:00.000Z";
const DURATION = 60;

const at = (minutesFromStart) =>
  new Date(new Date(START).getTime() + minutesFromStart * 60000).toISOString();

test("is upcoming well before the live window", () => {
  assert.equal(deriveEventState(START, DURATION, "scheduled", at(-60)), "upcoming");
});

test("is still upcoming one minute before the live window opens", () => {
  assert.equal(
    deriveEventState(START, DURATION, "scheduled", at(-LIVE_LEAD_MINUTES - 1)),
    "upcoming"
  );
});

test("is live exactly when the live window opens", () => {
  assert.equal(deriveEventState(START, DURATION, "scheduled", at(-LIVE_LEAD_MINUTES)), "live");
});

test("is live while the session runs", () => {
  assert.equal(deriveEventState(START, DURATION, "scheduled", at(0)), "live");
  assert.equal(deriveEventState(START, DURATION, "scheduled", at(59)), "live");
});

test("is finished as soon as the session ends", () => {
  assert.equal(deriveEventState(START, DURATION, "scheduled", at(60)), "finished");
});

test("a month-old event is finished even if nobody moved its card", () => {
  assert.equal(deriveEventState(START, DURATION, "scheduled", at(60 * 24 * 30)), "finished");
});

test("stage done forces finished regardless of the clock", () => {
  assert.equal(deriveEventState(START, DURATION, "done", at(0)), "finished");
});

test("a cancelled future event explicitly set to done is finished", () => {
  assert.equal(deriveEventState(START, DURATION, "done", at(60 * 24 * 7)), "finished");
});

test("stage draft is still subject to the clock", () => {
  assert.equal(deriveEventState(START, DURATION, "draft", at(-60)), "upcoming");
  assert.equal(deriveEventState(START, DURATION, "draft", at(60)), "finished");
});

test("stage live is judged by the clock like any other stage", () => {
  assert.equal(deriveEventState(START, DURATION, "live", at(-60)), "upcoming");
  assert.equal(deriveEventState(START, DURATION, "live", at(0)), "live");
});

test("an unparseable start is treated as upcoming rather than throwing", () => {
  assert.equal(deriveEventState("not-a-date", 60, "scheduled", new Date()), "upcoming");
});

test("an unparseable now is treated as upcoming rather than throwing", () => {
  assert.equal(deriveEventState(START, DURATION, "scheduled", "not-a-date"), "upcoming");
  assert.equal(deriveEventState(START, DURATION, "scheduled", new Date("bogus")), "upcoming");
});

test("resolveDurationMinutes keeps a usable positive value", () => {
  assert.equal(resolveDurationMinutes(90), 90);
  assert.equal(resolveDurationMinutes(1), 1);
  assert.equal(resolveDurationMinutes("45"), 45);
});

test("resolveDurationMinutes falls back to 60 for anything unusable", () => {
  assert.equal(resolveDurationMinutes(0), 60);
  assert.equal(resolveDurationMinutes(-30), 60);
  assert.equal(resolveDurationMinutes(NaN), 60);
  assert.equal(resolveDurationMinutes(null), 60);
  assert.equal(resolveDurationMinutes(undefined), 60);
  assert.equal(resolveDurationMinutes("not-a-number"), 60);
  assert.equal(resolveDurationMinutes(Infinity), 60);
});

test("a zero duration is read as the default, not as an instant end", () => {
  assert.equal(deriveEventState(START, 0, "scheduled", at(59)), "live");
  assert.equal(deriveEventState(START, 0, "scheduled", at(60)), "finished");
});

test("a negative duration does not rewind the end of the event", () => {
  assert.equal(deriveEventState(START, -30, "scheduled", at(0)), "live");
  assert.equal(deriveEventState(START, -30, "scheduled", at(59)), "live");
  assert.equal(deriveEventState(START, -30, "scheduled", at(60)), "finished");
});

test("a NaN duration falls back to 60 minutes", () => {
  assert.equal(deriveEventState(START, NaN, "scheduled", at(59)), "live");
  assert.equal(deriveEventState(START, NaN, "scheduled", at(60)), "finished");
});

test("an omitted duration falls back to 60 minutes", () => {
  assert.equal(deriveEventState(START, undefined, "scheduled", at(59)), "live");
  assert.equal(deriveEventState(START, undefined, "scheduled", at(60)), "finished");
});
