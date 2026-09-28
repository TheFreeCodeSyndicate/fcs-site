import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveEventState, LIVE_LEAD_MINUTES } from "./derive.js";

const START = "2026-10-05T18:30:00.000Z";
const DURATION = 60;

const at = (minutesFromStart) =>
  new Date(new Date(START).getTime() + minutesFromStart * 60000).toISOString();

test("is upcoming well before the live window", () => {
  assert.equal(deriveEventState(at(-60), START, DURATION, "scheduled"), "upcoming");
});

test("is still upcoming one minute before the live window opens", () => {
  assert.equal(
    deriveEventState(at(-LIVE_LEAD_MINUTES - 1), START, DURATION, "scheduled"),
    "upcoming"
  );
});

test("is live exactly when the live window opens", () => {
  assert.equal(
    deriveEventState(at(-LIVE_LEAD_MINUTES), START, DURATION, "scheduled"),
    "live"
  );
});

test("is live while the session runs", () => {
  assert.equal(deriveEventState(at(0), START, DURATION, "scheduled"), "live");
  assert.equal(deriveEventState(at(59), START, DURATION, "scheduled"), "live");
});

test("is finished as soon as the session ends", () => {
  assert.equal(deriveEventState(at(60), START, DURATION, "scheduled"), "finished");
});

test("a month-old event is finished even if nobody moved its card", () => {
  assert.equal(deriveEventState(at(60 * 24 * 30), START, DURATION, "scheduled"), "finished");
});

test("stage done forces finished regardless of the clock", () => {
  assert.equal(deriveEventState(at(0), START, DURATION, "done"), "finished");
});

test("a cancelled future event explicitly set to done is finished", () => {
  assert.equal(deriveEventState(at(60 * 24 * 7), START, DURATION, "done"), "finished");
});

test("stage draft is still subject to the clock", () => {
  assert.equal(deriveEventState(at(-60), START, DURATION, "draft"), "upcoming");
  assert.equal(deriveEventState(at(60), START, DURATION, "draft"), "finished");
});

test("an unparseable start is treated as upcoming rather than throwing", () => {
  assert.equal(deriveEventState(new Date(), "not-a-date", 60, "scheduled"), "upcoming");
});
