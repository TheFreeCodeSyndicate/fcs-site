import test from "node:test";
import assert from "node:assert/strict";
import { attributionLine, isAttributionLine, isSourceURL, normaliseAttribution } from "./attribution.js";
import { attributionLine as serverAttributionLine } from "../../supabase/functions/medium-import/medium.js";

test("isAttributionLine recognises the exact line and rejects invalid shapes", () => {
  const line = "Originally published on [Medium](https://medium.com/@who/story-1a2b)";
  assert.equal(isAttributionLine(line), true);
  assert.equal(isAttributionLine(`  ${line}  `), true);
  assert.equal(isAttributionLine(`> ${line}`), false, "block quote prefix is not part of block text");
  assert.equal(isAttributionLine("Originally published on [Medium](http://medium.com/@who/story-1a2b)"), false, "http is rejected");
  assert.equal(isAttributionLine("Originally published on [Medium](https://medium.com/@who/story 1a2b)"), false, "url with spaces is rejected");
  assert.equal(isAttributionLine("Originally published on Medium"), false, "plain text without link is rejected");
  assert.equal(isAttributionLine(`${line} and more`), false, "additional text is rejected");
  assert.equal(isAttributionLine(""), false);
  assert.equal(isAttributionLine(null), false);
  assert.equal(isAttributionLine(123), false);
});

test("attributionLine builds the expected string and trims padded urls", () => {
  const url = "https://medium.com/@who/story-1a2b";
  assert.equal(attributionLine(url), "Originally published on [Medium](https://medium.com/@who/story-1a2b)");
  assert.equal(attributionLine(`  ${url}  `), "Originally published on [Medium](https://medium.com/@who/story-1a2b)");
});

test("client and server attribution lines match", () => {
  const urls = [
    "https://medium.com/@who/story-1a2b",
    "https://example.com/story-123",
    "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7",
    "https://medium.com/@who/a-story-(part-one)-1a2b",
    "https://medium.com/@who/story?source=friends_link&sk=abc123",
    "  https://medium.com/@who/padded-1a2b  ",
  ];
  for (const u of urls) {
    assert.equal(`> ${attributionLine(u)}`, serverAttributionLine(u));
  }
});

test("any address the editor offers a box for is an address the line reads back", () => {
  // The two ends of one invariant: isSourceURL() decides whether a box exists,
  // and isAttributionLine decides whether the body carries the line. If they
  // disagree, the line can be written without being recognised - which showed
  // up as the restore row never going away and offering a second copy.
  const take = [
    "https://medium.com/@who/story-1a2b",
    "https://medium.com/@who/a-story-(part-one)-1a2b",
    "https://medium.com/@who/story?source=friends_link&sk=abc123",
    "https://medium.com/@who/trailing/punctuation-1a2b.",
  ];
  for (const u of take) {
    assert.equal(isSourceURL(u), true, u);
    assert.equal(isAttributionLine(attributionLine(u)), true, u);
    assert.equal(isAttributionLine(`> ${attributionLine(u)}`), false, "the marker stays in the block");
    assert.equal(normaliseAttribution(attributionLine(u)), `> ${attributionLine(u)}`, u);
  }
  // Refused: no box is offered, and a line written with one is left exactly as
  // it is. The markdown dialect only linkifies a lowercase scheme, so an
  // uppercase one could never be read back.
  const refuse = [
    "",
    null,
    undefined,
    "medium.com/@who/story-1a2b",
    "http://medium.com/@who/s-1a2b",
    "HTTPS://Medium.com/@who/shouty-1a2b",
    "https://medium.com/@who/a story",
    42,
  ];
  for (const bad of refuse) {
    assert.equal(isSourceURL(bad), false, JSON.stringify(bad));
  }
  const shouty = attributionLine("HTTPS://Medium.com/@who/shouty-1a2b");
  assert.equal(isAttributionLine(shouty), false, "a shouty address is not read back");
  assert.equal(normaliseAttribution(shouty), shouty, "and its line is left alone");
});

test("normaliseAttribution rewrites top-level paragraphs and leaves other blocks alone", () => {
  const untouched = [
    "- item 1\n- item 2",
    "+++ Toggle\nInside toggle\n+++",
    "::: columns\nLeft\n::: column\nRight\n:::",
    "```js\nconst x = 1;\n```",
    "![caption](https://example.com/pic.png)",
    "Centred text {: align=center color=red}",
  ].join("\n\n");
  assert.equal(normaliseAttribution(untouched), untouched);

  const converted = normaliseAttribution("Body\n\nOriginally published on [Medium](https://x.example/y)");
  assert.equal(converted, "Body\n\n> Originally published on [Medium](https://x.example/y)");

  const alreadyQuote = "Body\n\n> Originally published on [Medium](https://x.example/y)";
  assert.equal(normaliseAttribution(alreadyQuote), alreadyQuote);

  const onlyLine = "Originally published on [Medium](https://x.example/y)";
  assert.equal(normaliseAttribution(onlyLine), `> ${onlyLine}`);

  const middleLine = "Before\n\nOriginally published on [Medium](https://x.example/y)\n\nAfter";
  assert.equal(normaliseAttribution(middleLine), "Before\n\n> Originally published on [Medium](https://x.example/y)\n\nAfter");

  const insideToggle = "+++ Toggle\nOriginally published on [Medium](https://x.example/y)\n+++";
  assert.equal(normaliseAttribution(insideToggle), insideToggle);

  const insideColumn = "::: columns\nOriginally published on [Medium](https://x.example/y)\n::: column\nRight\n:::";
  assert.equal(normaliseAttribution(insideColumn), insideColumn);

  const merelyContains = "Prefix Originally published on [Medium](https://x.example/y) suffix";
  assert.equal(normaliseAttribution(merelyContains), merelyContains);

  const withAttrs = "Originally published on [Medium](https://x.example/y) {: align=center}";
  assert.equal(normaliseAttribution(withAttrs), "> Originally published on [Medium](https://x.example/y) {: align=center}");

  const sample = "Body\n\nOriginally published on [Medium](https://x.example/y)";
  assert.equal(normaliseAttribution(normaliseAttribution(sample)), normaliseAttribution(sample));
  assert.equal(normaliseAttribution(normaliseAttribution(untouched)), normaliseAttribution(untouched));
});
