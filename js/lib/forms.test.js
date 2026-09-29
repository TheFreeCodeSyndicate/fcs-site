import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalInputValue, fromLocalInputValue, formatDateTimeLocal } from "./forms.js";

test("an ISO instant round-trips through the datetime-local value", () => {
  const original = "2026-10-05T18:30:00.000Z";
  assert.equal(fromLocalInputValue(toLocalInputValue(original)), original);
});

test("a missing ISO string produces an empty input value", () => {
  assert.equal(toLocalInputValue(null), "");
  assert.equal(toLocalInputValue(undefined), "");
});

test("a blank input produces null rather than an Invalid Date", () => {
  assert.equal(fromLocalInputValue(""), null);
});

test("a malformed input produces null rather than an Invalid Date", () => {
  assert.equal(fromLocalInputValue("nonsense"), null);
});

test("an unparseable ISO string formats as an em dash", () => {
  assert.equal(formatDateTimeLocal("nonsense"), "—");
});

test("a valid ISO string produces readable text containing the year", () => {
  assert.match(formatDateTimeLocal("2026-10-05T18:30:00.000Z"), /2026/);
});

test("a blank ISO string formats as an em dash", () => {
  assert.equal(formatDateTimeLocal(""), "—");
});
