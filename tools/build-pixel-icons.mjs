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

/* Icons that are ours, not pixelarticons. They live here rather than only in
 * the output, so regenerating the sprite does not drop them.
 *
 * medium: Medium's serif M, from Medium's own brand pack (medium.design,
 * "Medium Logos (2024)"). The pack's icon is the wordmark's M set against a
 * clipped "e", so this is that M alone, its ink box centred in a square, on a
 * coordinate system that is not the 24px grid. A serif needs real
 * antialiasing, so the path overrides the sprite's crispEdges. */
const BRAND = [
  ["medium", "148.5 148.5 727 727", '<path shape-rendering="geometricPrecision" d="M836.115 244.625L836.923 244.448V238.195H672.014L518.891 598.084L365.768 238.195H188.059V244.448L188.857 244.625C218.957 251.419 234.239 261.551 234.239 298.091V725.872C234.239 762.412 218.898 772.544 188.798 779.338L188 779.516V785.788H308.57V779.535L307.773 779.358C277.672 772.564 262.39 762.432 262.39 725.892V322.905L459.093 785.788H470.249L672.683 309.996V736.457C670.104 765.317 654.96 774.228 627.705 780.382L626.897 780.569V786.773H836.923V780.569L836.115 780.382C808.831 774.228 793.322 765.317 790.743 736.457L790.605 298.091H790.743C790.743 261.551 806.024 251.419 836.115 244.625Z"/>'],
];
for (const [name, viewBox, inner] of BRAND) symbols.push(`<symbol id="p-${name}" viewBox="${viewBox}">${inner}</symbol>`);

writeFileSync("assets/pixel-icons.svg", `<svg xmlns="http://www.w3.org/2000/svg">
<!-- pixelarticons ${version} (MIT, (c) 2019 Gerrit Halfmann), https://pixelarticons.com.
     Built by tools/build-pixel-icons.mjs; ${names.length} pixelarticons, ${BRAND.length} brand, ids "p-<name>". -->
${symbols.join("\n")}
</svg>
`);
console.log(`assets/pixel-icons.svg: ${names.length} icons`);
