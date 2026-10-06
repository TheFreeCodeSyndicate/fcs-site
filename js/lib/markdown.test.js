import test from "node:test";
import assert from "node:assert/strict";
import { twemojiURL, renderMarkdown, plainSummary, parseBlocks, serializeBlocks, inline, youtubeId, readingTime } from "./markdown.js";

test("raw HTML is escaped, never passed through", () => {
  const html = renderMarkdown('<script>alert(1)</script> and "quotes"');
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("only https links and images become elements", () => {
  assert.match(renderMarkdown("[ok](https://a.example/x)"), /<a href="https:\/\/a\.example\/x" rel="noopener">ok<\/a>/);
  assert.ok(!renderMarkdown("[bad](javascript:alert(1))").includes("<a "));
  assert.ok(!renderMarkdown("[http](http://a.example)").includes("<a "));
  assert.match(renderMarkdown("![alt](https://cdn.example/a.webp)"), /<img src="https:\/\/cdn\.example\/a\.webp" alt="alt"/);
  assert.ok(!renderMarkdown("![x](data:text/html;base64,AAA)").includes("<img"));
  assert.ok(!renderMarkdown("@[bookmark](javascript:alert(1))").includes("<a "));
});

test("a quote can't break out of an attribute", () => {
  const html = renderMarkdown('![a" onerror="x](https://a.example/p.png)');
  assert.ok(!/onerror="/.test(html));
});

test("headings shift down a level and get anchors", () => {
  assert.equal(renderMarkdown("# Big"), '<h2 id="big">Big</h2>');
  assert.equal(renderMarkdown("### Small"), '<h4 id="small">Small</h4>');
  assert.match(renderMarkdown("# A\n\n# A"), /id="a-2"/);
});

test("inline formatting, escapes and code", () => {
  assert.equal(inline("**b** *i* ~~s~~ ==h== `a*b*c`"), "<strong>b</strong> <em>i</em> <s>s</s> <mark>h</mark> <code>a*b*c</code>");
  assert.equal(inline("\\*not italic\\*"), "*not italic*");
  assert.equal(inline("line\nbreak"), "line<br />break");
});

test("math renders through KaTeX, money does not", () => {
  assert.match(inline("$x^2$"), /class="math" data-tex="x\^2"/);
  assert.match(inline("$x^2$"), /katex/);
  assert.ok(!inline("$5 and $10").includes("katex"));
  assert.match(renderMarkdown("$$\n\\frac{a}{b}\n$$"), /class="math-block"/);
  assert.ok(!/href="javascript/.test(renderMarkdown("$$\\href{javascript:alert(1)}{x}$$")));
});

test("lists nest by indent, and to-dos carry their state", () => {
  assert.equal(renderMarkdown("- a\n  - b\n- c"), "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
  assert.equal(renderMarkdown("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
  assert.match(renderMarkdown("- [x] done\n- [ ] todo"), /class="todo is-done"><input type="checkbox" disabled checked/);
  assert.equal(renderMarkdown("- a\n1. b"), "<ul><li>a</li></ul><ol><li>b</li></ol>");
});

test("callouts, toggles, code, tables, embeds and contents", () => {
  assert.match(renderMarkdown("> [!💡] Tip\n> more"), /<aside class="callout"><span class="callout-icon" aria-hidden="true"><img class="emoji" src="[^"]+\/1f4a1\.svg" alt="💡" draggable="false" \/><\/span><div>Tip<br \/>more<\/div><\/aside>/);
  assert.match(renderMarkdown("+++ More\ninside\n+++"), /<details class="toggle"><summary>More<\/summary><div class="toggle-body"><p>inside<\/p><\/div><\/details>/);
  assert.match(renderMarkdown("```js\nconst a = 1;\n```"), /<figcaption>js<\/figcaption><pre><code class="hljs"><span class="hljs-keyword">const<\/span>/);
  assert.match(renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |"), /<th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td>/);
  assert.match(renderMarkdown("@[video](https://youtu.be/dQw4w9WgXcQ)"), /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(renderMarkdown("[[toc]]\n\n# One\n\n## Two"), /<nav class="toc" aria-label="Contents"><a class="toc-2" href="#one">One<\/a><a class="toc-3" href="#two">Two<\/a><\/nav>/);
  assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), "dQw4w9WgXcQ");
  assert.equal(youtubeId("https://evil.example/watch?v=dQw4w9WgXcQ"), null);
});

test("every block survives a round trip through serializeBlocks", () => {
  const blocks = [
    { type: "h1", text: "Title" },
    { type: "p", text: "Hello **there**\nsecond line" },
    { type: "p", text: "# not a heading" },
    { type: "bullet", indent: 0, text: "a" },
    { type: "bullet", indent: 1, text: "b" },
    { type: "number", indent: 0, text: "one" },
    { type: "number", indent: 0, text: "two" },
    { type: "todo", indent: 0, checked: true, text: "done" },
    { type: "quote", text: "q1\nq2" },
    { type: "callout", icon: "⚠️", text: "careful" },
    { type: "toggle", text: "More", children: [{ type: "p", text: "inside" }, { type: "toggle", text: "Deeper", children: [{ type: "p", text: "x" }] }] },
    { type: "code", lang: "md", code: "```\nfenced\n```" },
    { type: "math", tex: "e^{i\\pi}+1=0" },
    { type: "divider" },
    { type: "image", url: "https://cdn.example/a.webp", caption: "A [pic]" },
    { type: "video", url: "https://youtu.be/dQw4w9WgXcQ" },
    { type: "bookmark", url: "https://example.com" },
    { type: "table", rows: [["h1", "h|2"], ["a", ""]] },
    { type: "toc" },
  ];
  const md = serializeBlocks(blocks);
  const back = parseBlocks(md);
  assert.deepEqual(back.map((b) => b.type), blocks.map((b) => b.type));
  assert.equal(back[2].text, "\\# not a heading");
  assert.equal(renderMarkdown(md).includes("<h2 id=\"not"), false);
  assert.deepEqual(back[10].children.map((b) => b.type), ["p", "toggle"]);
  assert.equal(back[11].code, "```\nfenced\n```");
  assert.equal(back[14].caption, "A [pic]");
  assert.deepEqual(back[17].rows, [["h1", "h\\|2"], ["a", ""]]);
  assert.match(md, /^1\. one\n2\. two$/m);
  assert.equal(serializeBlocks(back), md);
});

test("plainSummary and readingTime read the words, not the markup", () => {
  assert.equal(plainSummary("# Hi\n\n**there** [link](https://a.example) ![i](https://a.example/i.png)"), "Hi there link i");
  assert.equal(plainSummary("a ".repeat(300)).length, 160);
  assert.deepEqual(readingTime("word ".repeat(440)), { words: 440, minutes: 2 });
});

test("twemoji file names follow Twemoji's rules", () => {
  const name = (e) => twemojiURL(e).split("/").pop();
  assert.equal(name("😀"), "1f600.svg");
  assert.equal(name("❤️"), "2764.svg");
  assert.equal(name("👩‍💻"), "1f469-200d-1f4bb.svg");
  assert.equal(name("🇮🇳"), "1f1ee-1f1f3.svg");
});
