import test from "node:test";
import assert from "node:assert/strict";
import { isAttributionLine, attributionLine, normaliseAttribution } from "./attribution.js";
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
  ];
  for (const u of urls) {
    assert.equal(`> ${attributionLine(u)}`, serverAttributionLine(u));
  }
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
