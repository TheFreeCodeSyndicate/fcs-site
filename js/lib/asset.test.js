import test from "node:test";
import assert from "node:assert/strict";
import { sniffType, refusal, assetPath, cdnURL, MAX_BYTES } from "../../supabase/functions/upload-asset/asset.js";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]); // RIFF but not WebP

test("sniffType reads the real format from the bytes", () => {
  assert.equal(sniffType(png), "image/png");
  assert.equal(sniffType(jpg), "image/jpeg");
  assert.equal(sniffType(webp), "image/webp");
  assert.equal(sniffType(svg), null);
  assert.equal(sniffType(wav), null);
});

test("refusal rejects empty, oversized and non-image uploads", () => {
  assert.equal(refusal(png), null);
  assert.match(refusal(new Uint8Array(0)), /No image/);
  assert.match(refusal(svg), /JPG, PNG or WebP/);
  const big = new Uint8Array(MAX_BYTES + 1);
  big.set(png);
  assert.match(refusal(big), /over 2 MB/);
});

test("assetPath is dated and takes its extension from the bytes", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  assert.equal(assetPath(webp, now, "abc"), "blog/2026/10/abc.webp");
  assert.equal(assetPath(jpg, now, "abc"), "blog/2026/10/abc.jpg");
});

test("cdnURL pins the commit", () => {
  assert.equal(
    cdnURL("deadbeef", "blog/2026/10/a.webp"),
    "https://cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@deadbeef/blog/2026/10/a.webp"
  );
});
