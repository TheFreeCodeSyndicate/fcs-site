import test from "node:test";
import assert from "node:assert/strict";
import { diffBlocks, changeSummary } from "./block-diff.js";

test("blocks added, removed and edited between two versions", () => {
  const before = "# Title\n\nFirst para.\n\nSecond para.\n\nThird para.";
  const after = "# Title\n\nFirst para, edited.\n\nThird para.\n\nA new ending.";
  const ops = diffBlocks(before, after);
  assert.deepEqual(ops.map((o) => o.op), ["same", "edit", "del", "same", "add"]);
  assert.equal(ops[1].was, "First para.");
  assert.equal(ops[1].md, "First para, edited.");
  assert.equal(ops[2].md, "Second para.");
});

test("a version's summary names what changed", () => {
  assert.equal(changeSummary(null, { body: "x" }), "First version");
  assert.equal(changeSummary({ body: "a\n\nb", title: "T" }, { body: "a\n\nb", title: "T" }), "No changes");
  assert.equal(changeSummary({ body: "a\n\nb", title: "T", icon: "" }, { body: "a2\n\nb\n\nc", title: "T2", icon: "🌱" }), "Edited 1 block, added 1 · title, icon");
  assert.equal(changeSummary({ body: "a", title: "T" }, { body: "a", title: "T", icon: "🌱" }), "No changes", "a field the older version lacks is not a change");
  assert.equal(changeSummary({ body: "a", title: "T" }, { body: "a", title: "U" }), "Changed title");
});
