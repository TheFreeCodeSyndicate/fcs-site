/*
 * tools/build-pixel-icons.mjs
 * ------------------------------------------------------------------
 * Builds assets/pixel-icons.svg, the sprite behind the blog editor's
 * icon picker: every pixelarticons icon (the "-sharp" style variants
 * left out), one <symbol id="p-<name>"> each, painted in currentColor
 * so a post's icon can take any colour.
 *
 * One-off, when upgrading pixelarticons:
 *   npm pack pixelarticons@2.4.1     (in a scratch folder)
 *   tar xzf pixelarticons-2.4.1.tgz
 *   node tools/build-pixel-icons.mjs <scratch>/package
 * ------------------------------------------------------------------
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pkg = process.argv[2];
if (!pkg) throw new Error("Usage: node tools/build-pixel-icons.mjs <unpacked pixelarticons package>");
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));

const names = readdirSync(join(pkg, "svg"))
  .filter((f) => f.endsWith(".svg") && !f.endsWith("-sharp.svg"))
  .map((f) => f.slice(0, -4))
  .sort();

const symbols = names.map((name) => {
  const svg = readFileSync(join(pkg, "svg", `${name}.svg`), "utf8");
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/\s*\n\s*/g, "");
  return `<symbol id="p-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
});

writeFileSync("assets/pixel-icons.svg", `<svg xmlns="http://www.w3.org/2000/svg">
<!-- pixelarticons ${version} (MIT, (c) 2019 Gerrit Halfmann), https://pixelarticons.com.
     Built by tools/build-pixel-icons.mjs; ${names.length} icons, ids "p-<name>". -->
${symbols.join("\n")}
</svg>
`);
console.log(`assets/pixel-icons.svg: ${names.length} icons`);
