import test from "node:test";
import assert from "node:assert/strict";
import {
  selectSections,
  rehostImages,
  assembleImport,
  handleAction,
} from "../../supabase/functions/medium-import/importer.js";

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
  <channel>
    <title><![CDATA[Stories by Yasser El-Sayed on Medium]]></title>
    <link>https://medium.com/@theyasser</link>
    <item>
      <title><![CDATA[The Hidden Cost of AI Code Assistants]]></title>
      <link>https://levelup.gitconnected.com/the-hidden-cost-of-ai-code-assistants-5123886e38bd</link>
      <guid isPermaLink="false">https://medium.com/p/5123886e38bd</guid>
      <dc:creator><![CDATA[Yasser El-Sayed]]></dc:creator>
      <pubDate>Wed, 23 Apr 2025 16:31:38 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Visualizing React Memoization]]></title>
      <link>https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7</link>
      <guid isPermaLink="false">https://medium.com/p/d734574ed2e7</guid>
      <dc:creator><![CDATA[Yasser El-Sayed]]></dc:creator>
      <pubDate>Thu, 19 Sep 2024 21:02:20 GMT</pubDate>
      <content:encoded><![CDATA[<p>One of the most useful features in React is memoization.</p><figure><img src="https://cdn-images-1.medium.com/max/1024/1*J0Sbi0sScfce1S1c-pv3hw.png" /><figcaption>Simple list</figcaption></figure>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const PUBLICATION_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
  <channel>
    <title><![CDATA[Medium.design - Medium]]></title>
    <link>https://medium.design</link>
    <item>
      <title><![CDATA[Newest Design Story]]></title>
      <link>https://medium.design/newest-design-story-111111111111</link>
      <guid isPermaLink="false">https://medium.com/p/111111111111</guid>
      <dc:creator><![CDATA[Desiree Garcia]]></dc:creator>
      <pubDate>Wed, 23 Apr 2025 16:31:38 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Design System Guidelines]]></title>
      <link>https://medium.design/design-system-guidelines-f1a01a733591</link>
      <guid isPermaLink="false">https://medium.com/p/f1a01a733591</guid>
      <dc:creator><![CDATA[Jason Combs]]></dc:creator>
      <pubDate>Thu, 19 Sep 2024 21:02:20 GMT</pubDate>
      <content:encoded><![CDATA[<p>Content of the design system story.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

// --- Step 1: Copy-agreement test ---
test("the importer copy of asset.js still agrees with upload-asset copy", async () => {
  const a = await import("../../supabase/functions/upload-asset/asset.js");
  const b = await import("../../supabase/functions/medium-import/asset.js");
  assert.equal(b.MAX_BYTES, a.MAX_BYTES);
  assert.equal(b.REPO, a.REPO);
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const d = new Date(Date.UTC(2026, 9, 17));
  assert.equal(b.assetPath(png, d, "x"), a.assetPath(png, d, "x"));
});

// --- Function 1: selectSections ---
test("selectSections keeps requested ids in their original story order", () => {
  const sections = [
    { id: "s1", markdown: "First section" },
    { id: "s2", markdown: "Second section" },
    { id: "s3", markdown: "Third section" },
    { id: "s4", markdown: "Fourth section" },
  ];
  // Requesting in reverse order: s3, then s1
  const { kept, dropped, warnings } = selectSections(sections, ["s3", "s1"]);
  assert.deepEqual(kept.map((s) => s.id), ["s1", "s3"]);
  assert.equal(dropped.length, 0);
  assert.equal(warnings.length, 0);
});

test("selectSections drops overflow sections from the end and reports warning", () => {
  const sections = [
    { id: "s1", markdown: "A".repeat(50) },
    { id: "s2", markdown: "B".repeat(50) },
    { id: "s3", markdown: "C".repeat(50) },
  ];
  // maxBody: 110 allows s1 (50) + join (2) + s2 (50) = 102. s3 would exceed 110.
  const { kept, dropped, warnings } = selectSections(sections, ["s1", "s2", "s3"], { maxBody: 110 });
  assert.deepEqual(kept.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(dropped.map((s) => s.id), ["s3"]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], "The story was longer than a post can hold; the last 1 section was left out.");
});

test("selectSections handles multiple dropped sections in warning message", () => {
  const sections = [
    { id: "s1", markdown: "A".repeat(50) },
    { id: "s2", markdown: "B".repeat(50) },
    { id: "s3", markdown: "C".repeat(50) },
  ];
  const { kept, dropped, warnings } = selectSections(sections, ["s1", "s2", "s3"], { maxBody: 60 });
  assert.deepEqual(kept.map((s) => s.id), ["s1"]);
  assert.deepEqual(dropped.map((s) => s.id), ["s2", "s3"]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], "The story was longer than a post can hold; the last 2 sections were left out.");
});

// --- Function 3: assembleImport ---
test("assembleImport joins kept sections with a blank line", () => {
  const sections = [
    { id: "s1", markdown: "# Title" },
    { id: "s2", markdown: "First paragraph." },
    { id: "s3", markdown: "Second paragraph." },
  ];
  const { markdown, cover } = assembleImport(sections);
  assert.equal(markdown, "# Title\n\nFirst paragraph.\n\nSecond paragraph.");
  assert.equal(cover, null);
});

test("assembleImport appends attributionLine only when attributionUrl is provided", () => {
  const sections = [{ id: "s1", markdown: "Hello world" }];
  const withoutAttr = assembleImport(sections);
  assert.equal(withoutAttr.markdown, "Hello world");

  const withAttr = assembleImport(sections, { attributionUrl: "https://medium.com/@author/story-1a2b3c4d5e6f" });
  assert.equal(
    withAttr.markdown,
    "Hello world\n\n> Originally published on [Medium](https://medium.com/@author/story-1a2b3c4d5e6f)"
  );
});

test("assembleImport sets cover from the first image of the first section with an image", () => {
  const sections = [
    { id: "s1", markdown: "No image here", blocks: [{ type: "p", text: "text" }] },
    {
      id: "s2",
      markdown: "![First](https://cdn.jsdelivr.net/gh/org/repo@sha/blog/2026/10/first.png)",
      blocks: [{ type: "image", url: "https://cdn.jsdelivr.net/gh/org/repo@sha/blog/2026/10/first.png", caption: "First" }],
    },
    {
      id: "s3",
      markdown: "![Second](https://cdn.jsdelivr.net/gh/org/repo@sha/blog/2026/10/second.png)",
      blocks: [{ type: "image", url: "https://cdn.jsdelivr.net/gh/org/repo@sha/blog/2026/10/second.png", caption: "Second" }],
    },
  ];
  const { cover } = assembleImport(sections);
  assert.deepEqual(cover, { url: "https://cdn.jsdelivr.net/gh/org/repo@sha/blog/2026/10/first.png" });
});

// --- Function 2: rehostImages ---
test("rehostImages copies images sequentially and rewrites block url to cdnURL", async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetched = [];
  const putCalls = [];

  const deps = {
    fetchBytes: async (url) => {
      fetched.push(url);
      return { bytes: pngBytes, type: "image/png" };
    },
    putAsset: async (bytes, ext) => {
      putCalls.push({ bytes, ext });
      return { sha: "abc1234", path: "blog/2026/10/test.png" };
    },
    now: new Date(Date.UTC(2026, 9, 17)),
    newID: () => "test-id",
  };

  const sections = [
    {
      id: "s1",
      markdown: "![Img 1](https://miro.medium.com/max/800/1*a.png)",
      blocks: [{ type: "image", url: "https://miro.medium.com/max/800/1*a.png", caption: "Img 1" }],
    },
  ];

  const result = await rehostImages(sections, deps);
  assert.equal(result.copied, 1);
  assert.equal(result.left.length, 0);
  assert.equal(result.sections[0].blocks[0].url, "https://cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@abc1234/blog/2026/10/test.png");
  assert.ok(result.sections[0].markdown.includes("https://cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@abc1234/blog/2026/10/test.png"));
  assert.deepEqual(fetched, ["https://miro.medium.com/max/800/1*a.png"]);
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].ext, "png");
});

test("rehostImages leaves images inside code blocks completely alone", async () => {
  const fetched = [];
  const deps = {
    fetchBytes: async (url) => {
      fetched.push(url);
      return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), type: "image/png" };
    },
    putAsset: async () => ({ sha: "sha", path: "path" }),
  };

  const sections = [
    {
      id: "s1",
      markdown: "```js\nconst img = '![x](https://miro.medium.com/max/800/1*code.png)';\n```",
      blocks: [{ type: "code", lang: "js", code: "const img = '![x](https://miro.medium.com/max/800/1*code.png)';" }],
    },
  ];

  const result = await rehostImages(sections, deps);
  assert.equal(result.copied, 0);
  assert.equal(result.left.length, 0);
  assert.equal(fetched.length, 0);
  assert.ok(result.sections[0].markdown.includes("https://miro.medium.com/max/800/1*code.png"));
});

test("rehostImages falls back to resizeURL when image exceeds maxBytes and resize is smaller", async () => {
  const bigBytes = new Uint8Array(2 * 1024 * 1024 + 100);
  bigBytes[0] = 0x89; bigBytes[1] = 0x50; bigBytes[2] = 0x4e; bigBytes[3] = 0x47;
  bigBytes[4] = 0x0d; bigBytes[5] = 0x0a; bigBytes[6] = 0x1a; bigBytes[7] = 0x0a;

  const smallBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const fetched = [];
  const deps = {
    fetchBytes: async (url) => {
      fetched.push(url);
      if (url.includes("resize:fit")) {
        return { bytes: smallBytes, type: "image/png" };
      }
      return { bytes: bigBytes, type: "image/png" };
    },
    putAsset: async (bytes, ext) => ({ sha: "sha999", path: "blog/2026/10/resized.png" }),
    maxBytes: 2 * 1024 * 1024,
  };

  const sections = [
    {
      id: "s1",
      markdown: "![Oversize](https://miro.medium.com/max/2400/1*heavy.png)",
      blocks: [{ type: "image", url: "https://miro.medium.com/max/2400/1*heavy.png", caption: "Oversize" }],
    },
  ];

  const result = await rehostImages(sections, deps);
  assert.equal(result.copied, 1);
  assert.equal(fetched.length, 2);
  assert.equal(fetched[0], "https://miro.medium.com/max/2400/1*heavy.png");
  assert.equal(fetched[1], "https://miro.medium.com/v2/resize:fit:1400/1*heavy.png");
  assert.ok(result.sections[0].markdown.includes("https://cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@sha999/blog/2026/10/resized.png"));
});

test("rehostImages refuses GIF and leaves it hotlinked with explanation in left", async () => {
  // GIF header: GIF89a
  const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

  const deps = {
    fetchBytes: async () => ({ bytes: gifBytes, type: "image/gif" }),
    putAsset: async () => { throw new Error("Should not be called for GIF"); },
  };

  const sections = [
    {
      id: "s1",
      markdown: "![Animation](https://cdn-images-1.medium.com/max/800/0*anim.gif)",
      blocks: [{ type: "image", url: "https://cdn-images-1.medium.com/max/800/0*anim.gif", caption: "Animation" }],
    },
  ];

  const result = await rehostImages(sections, deps);
  assert.equal(result.copied, 0);
  assert.equal(result.left.length, 1);
  assert.equal(result.left[0].url, "https://cdn-images-1.medium.com/max/800/0*anim.gif");
  assert.equal(result.left[0].why, "Use a JPG, PNG or WebP image.");
  assert.ok(result.sections[0].markdown.includes("https://cdn-images-1.medium.com/max/800/0*anim.gif"));
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0], "1 image was left hotlinked.");
});

test("rehostImages caps at limit and leaves remaining images hotlinked", async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const deps = {
    fetchBytes: async () => ({ bytes: pngBytes, type: "image/png" }),
    putAsset: async () => ({ sha: "sha", path: "path.png" }),
    limit: 2,
  };

  const sections = [
    {
      id: "s1",
      markdown: "![Img 1](https://miro.medium.com/max/800/1*a.png)",
      blocks: [{ type: "image", url: "https://miro.medium.com/max/800/1*a.png", caption: "1" }],
    },
    {
      id: "s2",
      markdown: "![Img 2](https://miro.medium.com/max/800/1*b.png)",
      blocks: [{ type: "image", url: "https://miro.medium.com/max/800/1*b.png", caption: "2" }],
    },
    {
      id: "s3",
      markdown: "![Img 3](https://miro.medium.com/max/800/1*c.png)",
      blocks: [{ type: "image", url: "https://miro.medium.com/max/800/1*c.png", caption: "3" }],
    },
  ];

  const result = await rehostImages(sections, deps);
  assert.equal(result.copied, 2);
  assert.equal(result.left.length, 1);
  assert.equal(result.left[0].url, "https://miro.medium.com/max/800/1*c.png");
  assert.ok(result.left[0].why.includes("limit"));
  assert.ok(result.warnings.some((w) => w.includes("Only 2 images can be imported per post")));
});

// A1: an image that cannot be fetched must not report a JavaScript error
test("rehostImages handles fetchBytes returning null with readable why", async () => {
  const deps = {
    fetchBytes: async () => null,
    putAsset: async () => ({ sha: "sha", path: "path" }),
  };
  const sections = [
    {
      id: "s1",
      markdown: "![Img](https://miro.medium.com/max/800/1*a.png)",
      blocks: [{ type: "image", url: "https://miro.medium.com/max/800/1*a.png", caption: "Img" }],
    },
  ];
  const result = await rehostImages(sections, deps);
  assert.equal(result.copied, 0);
  assert.equal(result.left.length, 1);
  assert.equal(result.left[0].url, "https://miro.medium.com/max/800/1*a.png");
  assert.ok(!result.left[0].why.includes("Cannot read properties"));
  assert.equal(result.left[0].why, "That image could not be fetched.");
});

// --- Function 4: handleAction ---
test("handleAction returns 400 for unknown action", async () => {
  const res = await handleAction({ action: "unknown" }, {});
  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes("Unknown action"));
});

// A5: a missing action should say so
test("handleAction reports missing action or unknown action accurately", async () => {
  const missing = await handleAction({}, {});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "Missing action.");

  const unrec = await handleAction({ action: "nope" }, {});
  assert.equal(unrec.status, 400);
  assert.ok(unrec.body.error.includes("nope"));
});

test("handleAction feed action fetches feed and returns source and stories", async () => {
  const deps = {
    fetchText: async (url) => {
      assert.equal(url, "https://medium.com/feed/@theyasser");
      return FEED_XML;
    },
  };
  const res = await handleAction({ action: "feed", input: "@theyasser" }, deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.source.author, "Yasser El-Sayed");
  assert.equal(res.body.source.url, "https://medium.com/feed/@theyasser");
  assert.equal(res.body.stories.length, 2);
  assert.equal(res.body.stories[1].id, "d734574ed2e7");
});

test("handleAction retries once on failed feed fetch", async () => {
  let attempts = 0;
  const deps = {
    fetchText: async (url) => {
      attempts++;
      if (attempts === 1) {
        throw new Error("Temporary network failure");
      }
      return FEED_XML;
    },
  };
  const res = await handleAction({ action: "feed", input: "@theyasser" }, deps);
  assert.equal(attempts, 2);
  assert.equal(res.status, 200);
  assert.equal(res.body.stories.length, 2);
});

test("handleAction returns 502 when feed fetch fails twice", async () => {
  const deps = {
    fetchText: async () => {
      throw new Error("Down");
    },
  };
  const res = await handleAction({ action: "feed", input: "@theyasser" }, deps);
  assert.equal(res.status, 502);
  assert.equal(res.body.error, "Medium didn't answer. Try again in a moment.");
});

test("handleAction story action returns sections without block model", async () => {
  const deps = {
    fetchText: async () => FEED_XML,
  };
  const res = await handleAction(
    { action: "story", url: "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7" },
    deps
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.sections.length > 0);
  // Ensure blocks property is NOT present on returned sections
  for (const s of res.body.sections) {
    assert.equal(s.blocks, undefined);
  }
  assert.equal(res.body.source.postId, "d734574ed2e7");
});

test("handleAction story action returns 404 when story is not in feed", async () => {
  const deps = {
    fetchText: async () => FEED_XML,
  };
  const res = await handleAction(
    { action: "story", url: "https://medium.com/@theyasser/non-existent-story-000000000000" },
    deps
  );
  assert.equal(res.status, 404);
  assert.ok(res.body.error.includes("newest ten"));
});

test("handleAction import action returns 409 with exact message when story leaves feed", async () => {
  const deps = {
    fetchText: async () => FEED_XML,
  };
  const res = await handleAction(
    { action: "import", url: "https://medium.com/@theyasser/old-story-000000000000", ids: ["s1"] },
    deps
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "That story left the feed while you were choosing. Open it again.");
});

// A4: a member-only story has not "left the feed"
test("handleAction import action returns 400 teaser error for member-only story instead of 409", async () => {
  const deps = {
    fetchText: async () => FEED_XML,
  };
  // Item 5123886e38bd has no content:encoded in FEED_XML
  const res = await handleAction(
    {
      action: "import",
      url: "https://levelup.gitconnected.com/the-hidden-cost-of-ai-code-assistants-5123886e38bd",
      ids: ["s1"],
    },
    deps
  );
  assert.equal(res.status, 400);
  assert.notEqual(res.status, 409);
  assert.equal(res.body.error, "Medium publishes only a teaser for member-only stories. Import it from the original document instead.");
});

// A2: attribution must be a boolean, or a real URL, or nothing
test("handleAction validates attribution parameter strictly", async () => {
  const deps = {
    fetchText: async () => FEED_XML,
  };
  // 1. attribution "true" (string) -> omitted
  const resStrTrue = await handleAction(
    {
      action: "import",
      url: "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7",
      ids: ["s1"],
      attribution: "true",
    },
    deps
  );
  assert.equal(resStrTrue.status, 200);
  assert.ok(!resStrTrue.body.markdown.includes("Originally published on [Medium]"));

  // 2. attribution true (boolean) -> uses story address
  const resBoolTrue = await handleAction(
    {
      action: "import",
      url: "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7",
      ids: ["s1"],
      attribution: true,
    },
    deps
  );
  assert.equal(resBoolTrue.status, 200);
  assert.ok(resBoolTrue.body.markdown.includes("Originally published on [Medium](https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7)"));

  // 3. attribution "https://x.example/y" -> uses that address
  const resCustomUrl = await handleAction(
    {
      action: "import",
      url: "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7",
      ids: ["s1"],
      attribution: "https://x.example/y",
    },
    deps
  );
  assert.equal(resCustomUrl.status, 200);
  assert.ok(resCustomUrl.body.markdown.includes("Originally published on [Medium](https://x.example/y)"));

  // 4. attribution "on" or stray string -> omitted
  const resOn = await handleAction(
    {
      action: "import",
      url: "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7",
      ids: ["s1"],
      attribution: "on",
    },
    deps
  );
  assert.equal(resOn.status, 200);
  assert.ok(!resOn.body.markdown.includes("Originally published on [Medium]"));
});

// A3: recovered third-party embeds must be noted
test("handleAction import action notes recovered third-party embeds in warnings without reporting image loss", async () => {
  const youtubeFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Embed Stories</title>
    <link>https://medium.com/@author</link>
    <item>
      <title>Video Story</title>
      <link>https://medium.com/@author/video-story-111111111111</link>
      <guid>https://medium.com/p/111111111111</guid>
      <dc:creator>Author</dc:creator>
      <pubDate>Thu, 19 Sep 2024 21:02:20 GMT</pubDate>
      <content:encoded><![CDATA[<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Watch this video</a></p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

  const deps = {
    fetchText: async () => youtubeFeedXml,
  };

  const res = await handleAction(
    {
      action: "import",
      url: "https://medium.com/@author/video-story-111111111111",
      ids: ["s1"],
    },
    deps
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.images.left, []);
  assert.ok(res.body.warnings.some((w) => w.includes("embed came through as a link rather than the original player")));
});

test("handleAction import action completes full flow with rehosting, assembly, and attribution", async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const deps = {
    fetchText: async () => FEED_XML,
    fetchBytes: async () => ({ bytes: pngBytes, type: "image/png" }),
    putAsset: async () => ({ sha: "sha123", path: "blog/2026/10/img.png" }),
    now: new Date(Date.UTC(2026, 9, 17)),
    newID: () => "uuid",
  };

  const res = await handleAction(
    {
      action: "import",
      url: "https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7",
      ids: ["s1", "s2"],
      attribution: true,
    },
    deps
  );

  assert.equal(res.status, 200);
  assert.ok(res.body.markdown.includes("Originally published on [Medium]"));
  assert.ok(res.body.markdown.includes("https://cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@sha123"));
  assert.deepEqual(res.body.cover, {
    url: "https://cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@sha123/blog/2026/10/img.png",
  });
  assert.equal(res.body.images.copied, 1);
  assert.ok(Array.isArray(res.body.warnings));
});

test("handleAction story action returns 404 for unlisted story on custom domain publication feed without misattributing author", async () => {
  const deps = {
    fetchText: async () => PUBLICATION_FEED_XML,
  };
  const res = await handleAction(
    { action: "story", url: "https://medium.design/logos-and-brand-guidelines-f1a01a733592" },
    deps
  );
  assert.equal(res.status, 404);
  assert.ok(res.body.error.includes("medium.design"));
  assert.ok(!res.body.error.includes("Desiree Garcia"));
  assert.ok(Array.isArray(res.body.stories) && res.body.stories.length > 0);
});

test("handleAction story action returns 200 for listed story on publication feed with story own author", async () => {
  const deps = {
    fetchText: async () => PUBLICATION_FEED_XML,
  };
  const res = await handleAction(
    { action: "story", url: "https://medium.design/design-system-guidelines-f1a01a733591" },
    deps
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.source.author, "Jason Combs");
});
