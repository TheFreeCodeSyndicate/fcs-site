import { test } from "node:test";
import assert from "node:assert/strict";
import { splitRepos } from "./repos.js";

const repo = (name) => ({ name, description: "", updated_at: "2026-09-01T00:00:00Z" });

test("an uncategorised repo defaults to project", () => {
  const { projects, resources } = splitRepos([repo("alpha")], []);
  assert.deepEqual(projects.map((r) => r.name), ["alpha"]);
  assert.equal(resources.length, 0);
});

test("a repo marked resource is pulled out of projects", () => {
  const { projects, resources } = splitRepos(
    [repo("alpha"), repo("notes")],
    [{ repo_name: "notes", kind: "resource" }]
  );
  assert.deepEqual(projects.map((r) => r.name), ["alpha"]);
  assert.deepEqual(resources.map((r) => r.name), ["notes"]);
});

test("a repo marked project explicitly stays in projects", () => {
  const { projects, resources } = splitRepos([repo("alpha")], [
    { repo_name: "alpha", kind: "project" },
  ]);
  assert.deepEqual(projects.map((r) => r.name), ["alpha"]);
  assert.equal(resources.length, 0);
});

test("classification is case sensitive on repo name, matching GitHub", () => {
  const { projects, resources } = splitRepos([repo("Notes")], [
    { repo_name: "notes", kind: "resource" },
  ]);
  assert.deepEqual(projects.map((r) => r.name), ["Notes"]);
  assert.equal(resources.length, 0);
});

test("a curated entry for a repo that no longer exists is ignored", () => {
  const { projects, resources } = splitRepos([repo("alpha")], [
    { repo_name: "deleted-repo", kind: "resource" },
  ]);
  assert.equal(projects.length, 1);
  assert.equal(resources.length, 0);
});

test("the curated note is carried onto the resource for display", () => {
  const { resources } = splitRepos([repo("notes")], [
    { repo_name: "notes", kind: "resource", note: "Start here" },
  ]);
  assert.equal(resources[0].curated_note, "Start here");
});

test("handles null and undefined inputs", () => {
  assert.deepEqual(splitRepos(null, null), { projects: [], resources: [] });
  assert.deepEqual(splitRepos(undefined, undefined), { projects: [], resources: [] });
});

test("an unnamed repo row is skipped rather than rendered blank", () => {
  const { projects, resources } = splitRepos([{ description: "orphan" }], []);
  assert.equal(projects.length, 0);
  assert.equal(resources.length, 0);
});

test("neither output array shares objects with the input", () => {
  const input = [repo("alpha"), repo("notes")];
  const snapshot = structuredClone(input);
  const { projects, resources } = splitRepos(input, [
    { repo_name: "notes", kind: "resource" },
  ]);

  projects[0].description = "mutated";
  resources[0].description = "mutated too";
  resources[0].curated_note = "edited";

  assert.deepEqual(input, snapshot);
  assert.equal(input[0].description, "");
  assert.equal(input[1].description, "");
});

test("a hidden repo is on neither list", () => {
  const { projects, resources } = splitRepos([repo("alpha"), repo("old-fork"), repo("notes")], [
    { repo_name: "old-fork", kind: "hidden" },
    { repo_name: "notes", kind: "resource" },
  ]);
  assert.deepEqual(projects.map((r) => r.name), ["alpha"]);
  assert.deepEqual(resources.map((r) => r.name), ["notes"]);
});
