import test from "node:test";
import assert from "node:assert/strict";
import { attributionLine, isAttributionLine, isSourceURL, lineAddress, normaliseAttribution } from "./attribution.js";
import { attributionLine as serverAttributionLine, lineAddress as serverLineAddress } from "../../supabase/functions/medium-import/medium.js";

/** Characters the markdown dialect would eat, or that cannot sit raw in a link:
 *  the same set the module encodes. */
const HOSTILE = ")*`~^$\\[]<>\"{}|";

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

test("lineAddress encodes what the dialect would eat and leaves the rest alone", () => {
  // Plain addresses come through untouched, down to the query and fragment.
  const plain = "https://medium.com/@who/plain-_.-path+more?q=1&r=2#frag";
  assert.equal(lineAddress(plain), plain);
  assert.equal(lineAddress(plain), "https://medium.com/@who/plain-_.-path+more?q=1&r=2#frag");

  // The scheme is lowercased - the dialect linkifies nothing else - and the
  // characters that the dialect eats or that cannot sit raw in a link are
  // percent-encoded.
  assert.equal(
    lineAddress("HTTPS://medium.com/@who/a(b)c*d~e^f$g[h]i{j}k|l<m>n\"o\\p"),
    "https://medium.com/@who/a(b%29c%2Ad%7Ee%5Ef%24g%5Bh%5Di%7Bj%7Dk%7Cl%3Cm%3En%22o%5Cp",
  );

  // Encoding is idempotent, so the line the row builds from the same address
  // is the line the body already holds.
  const hostile = "https://medium.com/@who/a(b)c*d~e^f$g[h]i\\j";
  assert.equal(lineAddress(lineAddress(hostile)), lineAddress(hostile));
  assert.equal(attributionLine(hostile), attributionLine(lineAddress(hostile)));
});

test("client and server attribution lines match", () => {
  const urls = [
    "https://medium.com/@who/story-1a2b",
    "https://example.com/story-123",
    "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7",
    "https://medium.com/@who/a-story-(part-one)-1a2b",
    "https://medium.com/@who/story?source=friends_link&sk=abc123",
    "  https://medium.com/@who/padded-1a2b  ",
    "HTTPS://Medium.com/@who/Shouty-1a2b",
    "https://medium.com/@who/star*star~tilde^caret$dollar`tick",
    "https://example.com/~jane/story-(draft)-1/",
    "https://example.com/a[b]c\\d<e>f\"g{h}i|j",
  ];
  for (const u of urls) {
    assert.equal(`> ${attributionLine(u)}`, serverAttributionLine(u));
  }
  // The encoding itself, character by character: the two copies of lineAddress
  // cannot drift on any of them.
  for (const c of HOSTILE) {
    urls.push(`https://medium.com/@who/a${c}b-1a2b`, `https://medium.com/@who/a${c}b${c}c-1a2b`);
  }
  for (const u of urls) {
    assert.equal(lineAddress(u), serverLineAddress(u), u);
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
    "https://medium.com/@who/~jane/story-1a2b",
    "HTTPS://Medium.com/@who/Shouty-1a2b",
  ];
  // Every character the dialect would eat, alone and doubled. The address is
  // made carryable rather than refused - the line is the credit the writer
  // asked for - so this invariant has to hold for all of them too. A doubled
  // "*" is what turns into <em> inside the href, a lone ")" is what cuts the
  // link; both are measured in .shots/url-charset-probe.html.
  for (const c of HOSTILE) {
    take.push(`https://medium.com/@who/a${c}b-1a2b`, `https://medium.com/@who/a${c}b${c}c-1a2b`);
  }
  for (const u of take) {
    assert.equal(isSourceURL(u), true, u);
    assert.equal(isAttributionLine(attributionLine(u)), true, u);
    assert.equal(isAttributionLine(`> ${attributionLine(u)}`), false, "the marker stays in the block");
    assert.equal(normaliseAttribution(attributionLine(u)), `> ${attributionLine(u)}`, u);
  }
  // Refused: no box is offered, because there is no https address to point at.
  const refuse = [
    "",
    null,
    undefined,
    "medium.com/@who/story-1a2b",
    "http://medium.com/@who/s-1a2b",
    "https://medium.com/@who/a story",
    42,
  ];
  for (const bad of refuse) {
    assert.equal(isSourceURL(bad), false, JSON.stringify(bad));
  }
  // A line whose address the dialect would cut in two is not recognised: no box
  // is offered for it, and it is left exactly as it is, rather than rewritten
  // into a quote whose link would still be wrong. That is a hand-written line,
  // or one written before the address was encoded.
  const unrestorable = "Originally published on [Medium](https://medium.com/@who/a)cut-1a2b)";
  assert.equal(isAttributionLine(unrestorable), false, unrestorable);
  assert.equal(normaliseAttribution(unrestorable), unrestorable, unrestorable);

  // A shouty scheme in a *line* is another matter: the page reads a line the
  // dialect does not link back as literal escaped brackets, so it cannot be
  // recognised however the post's address is written. The line built from a
  // shouty address is the lowercase one, and that is recognised, so the box a
  // post with such an address is offered works.
  assert.equal(isAttributionLine("Originally published on [Medium](HTTPS://medium.com/@who/Shouty-1a2b)"), false);
  assert.equal(isAttributionLine(attributionLine("HTTPS://Medium.com/@who/Shouty-1a2b")), true);
  assert.equal(attributionLine("HTTPS://Medium.com/@who/Shouty-1a2b"), "Originally published on [Medium](https://Medium.com/@who/Shouty-1a2b)");
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
