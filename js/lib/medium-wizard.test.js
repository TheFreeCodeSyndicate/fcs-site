import test from "node:test";
import assert from "node:assert/strict";
import {
  clipTitle,
  excerptFor,
  applyShortcut,
  summarise,
  findDuplicate,
} from "./medium-wizard.js";

test("clipTitle collapses whitespace and trims", () => {
  assert.equal(clipTitle(""), "");
  assert.equal(clipTitle(null), "");
  assert.equal(clipTitle(undefined), "");
  assert.equal(clipTitle("   \n\t  "), "");
  assert.equal(clipTitle("   Hello   World \n from   Medium!  "), "Hello World from Medium!");
});

test("clipTitle boundaries: 160-char untouched, 161-char clipped, never exceeds max", () => {
  const str160 = "a".repeat(160);
  assert.equal(clipTitle(str160, 160), str160);
  assert.equal(clipTitle(str160, 160).length, 160);

  const str161 = "b".repeat(161);
  const clipped = clipTitle(str161, 160);
  assert.equal(clipped, "b".repeat(160));
  assert.equal(clipped.length, 160);
  assert.ok(clipped.length <= 160);

  // Default max is 160
  assert.equal(clipTitle(str161), "b".repeat(160));

  // Custom max
  assert.equal(clipTitle("abcdefghij", 5), "abcde");
});

test("clipTitle never splits a surrogate pair", () => {
  // An emoji is a surrogate pair (2 code units, 1 code point: \uD83D\uDE00)
  const text = "abc😀def";
  // Slicing to 4 code points returns "abc😀"
  const clipped4 = clipTitle(text, 4);
  assert.equal(clipped4, "abc😀");
  assert.equal([...clipped4].length, 4);

  // If clipped to 3 code points, it cleanly drops the emoji without a dangling surrogate
  const clipped3 = clipTitle(text, 3);
  assert.equal(clipped3, "abc");

  // String of emojis
  const emojis = "😀😃😄😁😆";
  const threeEmojis = clipTitle(emojis, 3);
  assert.equal(threeEmojis, "😀😃😄");
  assert.equal([...threeEmojis].length, 3);
});

test("excerptFor derives a plain summary capped at 300 chars", () => {
  const md = "# Heading\n\nThis is the **first** paragraph of the story.\n\nSecond paragraph.";
  const summary = excerptFor(md);
  assert.ok(summary.includes("This is the first paragraph"));
  assert.ok(!summary.includes("#"));
  assert.ok(!summary.includes("**"));
  assert.ok(summary.length <= 300);

  const longMd = "Word ".repeat(100);
  const longSummary = excerptFor(longMd);
  assert.ok(longSummary.length <= 300);
});

test("applyShortcut returns section ids in original order according to shortcut name", () => {
  const sections = [
    { id: "s1", kind: "heading" },
    { id: "s2", kind: "image" },
    { id: "s3", kind: "paragraph" },
    { id: "s4", kind: "image" },
    { id: "s5", kind: "code" },
  ];

  assert.deepEqual(applyShortcut("all", sections), ["s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(applyShortcut("none", sections), []);
  assert.deepEqual(applyShortcut("text", sections), ["s1", "s3", "s5"]);
  assert.deepEqual(applyShortcut("images", sections), ["s2", "s4"]);
  // Unknown name returns every id unchanged
  assert.deepEqual(applyShortcut("custom", sections), ["s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(applyShortcut("", sections), ["s1", "s2", "s3", "s4", "s5"]);
});

test("summarise builds short toast sentence and tone", () => {
  // Clean success without images
  const s1 = summarise([], { copied: 0, left: [] });
  assert.equal(s1.tone, "success");
  assert.ok(typeof s1.message === "string" && s1.message.length > 0);
  assert.ok(!s1.message.includes("\n"));

  // Clean success with copied images
  const s2 = summarise([], { copied: 3, left: [] });
  assert.equal(s2.tone, "success");
  assert.ok(s2.message.includes("3"));

  // Server warnings present -> info
  const s3 = summarise(["2 embeds were left out because Medium does not export them."], { copied: 2, left: [] });
  assert.equal(s3.tone, "info");
  assert.ok(s3.message.includes("2 embeds"));

  // Partial image failure -> info
  const s4 = summarise([], { copied: 2, left: [{ url: "https://example.com/bad.png", why: "That image could not be fetched." }] });
  assert.equal(s4.tone, "info");
  assert.ok(s4.message.includes("1 image"));

  // Total image failure -> error
  const s5 = summarise([], { copied: 0, left: [{ url: "https://example.com/bad.png", why: "That image could not be fetched." }] });
  assert.equal(s5.tone, "error");
  assert.ok(s5.message.length > 0);

  // Both warnings and left images -> info
  const s6 = summarise(["1 embed left out."], { copied: 1, left: [{ url: "https://example.com/bad.png", why: "error" }] });
  assert.equal(s6.tone, "info");
});

test("findDuplicate finds the first matching post by source_url or null", () => {
  const posts = [
    { id: "1", title: "First Post", source_url: "https://medium.com/@author/story-one-111111111111" },
    { id: "2", title: "Second Post", source_url: "https://medium.com/@author/story-two-222222222222" },
  ];

  assert.deepEqual(
    findDuplicate(posts, "https://medium.com/@author/story-two-222222222222"),
    posts[1]
  );
  assert.equal(findDuplicate(posts, "https://medium.com/@author/non-existent-333333333333"), null);
  assert.equal(findDuplicate([], "https://medium.com/@author/story-one-111111111111"), null);
  assert.equal(findDuplicate(null, "https://medium.com/@author/story-one-111111111111"), null);
  assert.equal(findDuplicate(posts, null), null);
  assert.equal(findDuplicate(posts, ""), null);
});
