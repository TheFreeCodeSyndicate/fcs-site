import { test } from "node:test";
import assert from "node:assert/strict";
import { pose, compose, shade, GRID_W } from "./bird.js";

test("he faces where he is heading", () => {
  assert.equal(pose(0, 0).view, "front");
  assert.equal(pose(0, 0).dx, 0);
  assert.equal(pose(0.5, 0).dx > 0, true);
  assert.equal(pose(1, 0).view, "side");
  assert.equal(pose(0, -1).view, "back");
  assert.equal(pose(0.6, 0, "side").view, "side"); // hysteresis
  assert.equal(pose(0.6, 0, "front").view, "front");
});

test("flying left is flying right, mirrored", () => {
  const right = compose(pose(1, 0), "mid", false);
  const left = compose(pose(-1, 0), "mid", false);
  assert.deepEqual(left, right.map((row) => [...row].reverse()));
  assert.equal(right[0].length, GRID_W);
});

test("the outline facing the sun is the lit one", () => {
  const g = compose(pose(0, 0), "mid", false);
  const lit = shade(g, 1, 0, 1); // sun to the right
  const row = 15;
  const first = g[row].indexOf("r"), last = g[row].lastIndexOf("r");
  const red = (c) => Number(c.match(/\d+/)[0]);
  assert.ok(red(lit[row][last]) > red(lit[row][first]) + 60);
});

test("a smile changes only his eyes", () => {
  const plain = compose(pose(0, 0), "mid", false);
  const happy = compose(pose(0, 0), "mid", false, "smile");
  const changed = plain.flatMap((row, j) => row.map((c, i) => (c !== happy[j][i] ? j : null))).filter((j) => j !== null);
  assert.ok(changed.length > 0);
  assert.ok(changed.every((j) => j >= 9 && j <= 10)); // the two lens rows
});
