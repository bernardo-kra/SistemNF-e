import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { normalizeStaticSegments } from "../scripts/normalize-static-segments.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "sistem-export-"));
  if (
    dirname(root) !== resolve(tmpdir()) ||
    !basename(root).startsWith("sistem-export-")
  )
    throw new Error("Unexpected temporary directory");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test("nested segment export gains the client-requested filename without changing HTML", (t) => {
  const root = fixture(t);
  const route = join(root, "fiscal", "revisao");
  const nested = join(route, "__next.!group", "fiscal", "revisao");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "__PAGE__.txt"), "segment-content");
  writeFileSync(join(route, "index.html"), "original-html");
  assert.equal(normalizeStaticSegments(root), 1);
  assert.equal(
    readFileSync(
      join(route, "__next.!group.fiscal.revisao.__PAGE__.txt"),
      "utf8",
    ),
    "segment-content",
  );
  assert.equal(
    readFileSync(join(route, "index.html"), "utf8"),
    "original-html",
  );
  assert.equal(normalizeStaticSegments(root), 0);
});
test("already portable exports remain unchanged", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "__next.!group.__PAGE__.txt"), "portable");
  assert.equal(normalizeStaticSegments(root), 0);
  assert.equal(
    readFileSync(join(root, "__next.!group.__PAGE__.txt"), "utf8"),
    "portable",
  );
});
test("a conflicting alias fails instead of replacing a different segment", (t) => {
  const root = fixture(t);
  const nested = join(root, "__next.!group", "fiscal");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "__PAGE__.txt"), "new");
  const target = join(root, "__next.!group.fiscal.__PAGE__.txt");
  writeFileSync(target, "existing");
  assert.throws(
    () => normalizeStaticSegments(root),
    /Conflicting static segment/,
  );
  assert.equal(readFileSync(target, "utf8"), "existing");
});
