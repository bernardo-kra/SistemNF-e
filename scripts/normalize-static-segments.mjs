import { copyFileSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Next.js on Windows may export segment files as nested directories while the
// client requests dot-separated filenames. Keep the originals and add portable
// aliases. Remove this workaround after verifying a fixed Next.js export.
// https://github.com/vercel/next.js/issues/92339
export function normalizeStaticSegments(directory) {
  let copied = 0;
  function flatten(segmentDirectory, current = segmentDirectory) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const source = join(current, entry.name);
      if (entry.isDirectory()) flatten(segmentDirectory, source);
      else if (entry.isFile() && entry.name.endsWith(".txt")) {
        const suffix = relative(segmentDirectory, source).split(sep).join(".");
        const target = join(
          dirname(segmentDirectory),
          `${basename(segmentDirectory)}.${suffix}`,
        );
        try {
          if (!readFileSync(target).equals(readFileSync(source))) {
            throw new Error(`Conflicting static segment: ${target}`);
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          copyFileSync(source, target);
          copied++;
        }
      }
    }
  }
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (entry.name.startsWith("__next.")) flatten(child);
      else if (entry.name !== "_next") visit(child);
    }
  }
  visit(resolve(directory));
  return copied;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    `Static export: ${normalizeStaticSegments("out")} segment alias(es) added.`,
  );
}
