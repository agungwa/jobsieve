// Generates PNG favicons / touch icon / OG image from the SVG brand mark.
// Run: bun run gen:icons   (after editing web/public/favicon.svg or og banner)
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const pub = new URL("../public/", import.meta.url).pathname;

const mark = await readFile(pub + "favicon.svg");

const sizes = [
  ["favicon-16x16.png", 16],
  ["favicon-32x32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];

for (const [name, size] of sizes) {
  await sharp(mark, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(pub + name);
  console.log("wrote", name);
}

// Open Graph banner: 1200x630, mark + wordmark on a soft gradient.
const banner = await readFile(pub + "og-banner.svg");
await sharp(banner, { density: 150 })
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toFile(pub + "og-image.png");
console.log("wrote og-image.png");
