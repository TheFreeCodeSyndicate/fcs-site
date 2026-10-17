import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalInputValue, fromLocalInputValue, formatDateTimeLocal, slugify, uniqueSlug } from "./forms.js";

const DB_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

test("slugify makes a clean address, even from accents and symbols", () => {
  assert.equal(slugify("Hello, World! 2026"), "hello-world-2026");
  assert.equal(slugify("  Café --- au lait  "), "cafe-au-lait");
  assert.equal(slugify("!!!"), "");
  assert.ok(slugify("a ".repeat(100)).length <= 80);
  assert.ok(!slugify("a".repeat(79) + " b").endsWith("-"));
});

test("uniqueSlug returns free base unchanged and satisfies db constraint", () => {
  const cases = [
    uniqueSlug("my-post", []),
    uniqueSlug("my-post", ["other-post"]),
    uniqueSlug("my-post", new Set(["different-post"])),
  ];
  for (const s of cases) {
    assert.equal(s, "my-post");
    assert.ok(s.length <= 80);
    assert.match(s, DB_SLUG_REGEX);
  }
});

test("uniqueSlug gives -2 when base is taken", () => {
  const s = uniqueSlug("my-post", ["my-post"]);
  assert.equal(s, "my-post-2");
  assert.ok(s.length <= 80);
  assert.match(s, DB_SLUG_REGEX);
});

test("uniqueSlug gives -3 when base and -2 are taken", () => {
  const s = uniqueSlug("my-post", ["my-post", "my-post-2"]);
  assert.equal(s, "my-post-3");
  assert.ok(s.length <= 80);
  assert.match(s, DB_SLUG_REGEX);
});

test("uniqueSlug gives empty string for empty base", () => {
  assert.equal(uniqueSlug("", []), "");
  assert.equal(uniqueSlug(null, []), "");
  assert.equal(uniqueSlug(undefined, []), "");
});

test("uniqueSlug truncates long base to fit 80 chars, avoids trailing dash, and matches db regex", () => {
  const base80 = "a".repeat(80);
  const s2 = uniqueSlug(base80, [base80]);
  assert.equal(s2, "a".repeat(78) + "-2");
  assert.equal(s2.length, 80);
  assert.match(s2, DB_SLUG_REGEX);
  assert.ok(!s2.endsWith("-"));

  const s3 = uniqueSlug(base80, [base80, s2]);
  assert.equal(s3, "a".repeat(78) + "-3");
  assert.equal(s3.length, 80);
  assert.match(s3, DB_SLUG_REGEX);
  assert.ok(!s3.endsWith("-"));

  // Truncation boundary landing on a dash must not yield double dash or trailing dash
  const baseDash = "a".repeat(77) + "-bc";
  assert.equal(baseDash.length, 80);
  const sDash = uniqueSlug(baseDash, [baseDash]);
  assert.equal(sDash, "a".repeat(77) + "-2");
  assert.equal(sDash.length, 79);
  assert.ok(sDash.length <= 80);
  assert.match(sDash, DB_SLUG_REGEX);
  assert.ok(!sDash.includes("--"));
  assert.ok(!sDash.endsWith("-"));

  // Multi-digit suffix truncation when suffixes -2 through -9 are taken
  const takenSet = new Set([base80, ...Array.from({ length: 8 }, (_, i) => "a".repeat(78) + `-${i + 2}`)]);
  const s10 = uniqueSlug(base80, takenSet);
  assert.equal(s10, "a".repeat(77) + "-10");
  assert.equal(s10.length, 80);
  assert.match(s10, DB_SLUG_REGEX);
  assert.ok(!s10.endsWith("-"));
});
