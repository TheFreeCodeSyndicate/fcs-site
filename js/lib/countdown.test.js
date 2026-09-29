import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCountdown } from "./countdown.js";

const m = (minutes) => minutes * 60 * 1000;

test("days, hours and minutes", () => {
  assert.equal(formatCountdown(m(60 * 24 * 2 + 60 * 4 + 13)), "2d 04h 13m");
});

test("hours and minutes when under a day", () => {
  assert.equal(formatCountdown(m(60 * 5 + 7)), "5h 07m");
});

test("minutes and seconds when under an hour", () => {
  assert.equal(formatCountdown(m(42)), "42m 00s");
});

test("seconds tick down within the final minute", () => {
  assert.equal(formatCountdown(45 * 1000), "0m 45s");
});

test("zero is padded", () => {
  assert.equal(formatCountdown(0), "0m 00s");
});

test("negative counts as zero rather than rendering backwards", () => {
  assert.equal(formatCountdown(-5000), "0m 00s");
});

test("a full day minus one second never renders as a whole day", () => {
  assert.equal(formatCountdown(m(60 * 24) - 1000), "23h 59m");
});

test("exactly one day renders with a day segment", () => {
  assert.equal(formatCountdown(m(60 * 24)), "1d 00h 00m");
});

test("a non-numeric input degrades to zero rather than NaN", () => {
  assert.equal(formatCountdown("nonsense"), "0m 00s");
});
