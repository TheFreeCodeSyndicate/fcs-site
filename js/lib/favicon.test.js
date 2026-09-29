import { test } from "node:test";
import assert from "node:assert/strict";
import { faviconURL, knownSiteIcon, linkIcon, platformIcon } from "../render.js";

test("known sites are recognised from the link itself", () => {
  const cases = {
    "https://www.linkedin.com/company/x/": "linkedin",
    "https://lnkd.in/abc": "linkedin",
    "https://discord.gg/abc": "discord",
    "https://fcs.github.io/notes": "github",
    "https://twitter.com/fcs": "x",
    "https://youtu.be/abc": "youtube",
    "https://chat.whatsapp.com/abc": "whatsapp",
    "mailto:hi@example.com": "mail",
  };
  for (const [url, name] of Object.entries(cases)) assert.equal(knownSiteIcon(url), name, url);
  // a lookalike domain is not the real site
  assert.equal(knownSiteIcon("https://notlinkedin.com"), null);
  assert.equal(knownSiteIcon("https://linkedin.com.evil.test"), null);
});

test("a known site gets its pixel icon, even when saved as web", () => {
  assert.match(platformIcon("web", "", "https://www.linkedin.com/company/x/"), /#i-linkedin/);
  assert.match(linkIcon("https://www.youtube.com/@fcs"), /#i-youtube/);
});

test("an unknown site asks for its favicon by domain only", () => {
  assert.equal(faviconURL("https://blog.example.com/post?id=1#x"),
    "https://www.google.com/s2/favicons?domain=blog.example.com&sz=64");
  const html = linkIcon("https://www.notion.so/fcs", "", "bookmark");
  assert.match(html, /^<img class="icon icon-favicon/);
  assert.match(html, /data-fallback="bookmark"/);
});

test("anything that is not an http(s) link gets the fallback icon", () => {
  for (const url of ["javascript:alert(1)", "", "not a url", "data:text/html,x"]) {
    assert.equal(faviconURL(url), "");
    assert.match(platformIcon("other", "", url), /#i-link/);
  }
  assert.match(linkIcon("", "", "globe"), /#i-globe/);
  assert.match(platformIcon("x"), /#i-x/);
});
