import { test } from "node:test";
import assert from "node:assert/strict";
import { faviconURL, platformIcon } from "../render.js";

test("an other link asks for its site's favicon by domain only", () => {
  assert.equal(faviconURL("https://blog.example.com/post?id=1#x"),
    "https://www.google.com/s2/favicons?domain=blog.example.com&sz=64");
  assert.match(platformIcon("other", "", "https://example.com"), /^<img class="icon icon-favicon/);
});

test("anything that is not an http(s) link falls back to the link icon", () => {
  for (const url of ["javascript:alert(1)", "", "not a url", "data:text/html,x"]) {
    assert.equal(faviconURL(url), "");
    assert.match(platformIcon("other", "", url), /#i-link/);
  }
  assert.match(platformIcon("x"), /#i-x/);
});
