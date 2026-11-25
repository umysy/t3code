// oxlint-disable-next-line t3code/namespace-node-imports -- keep the script's Node dependencies explicit
import { mkdir } from "node:fs/promises";
// oxlint-disable-next-line t3code/namespace-node-imports -- keep the script's Node dependencies explicit
import path from "node:path";
import sharp from "sharp";

const mobileRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(mobileRoot, "assets/fork");
const glyph = `<svg width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="60" fill="#F97316"/><path d="M42 42v8c0 12 10 18 22 18s22-6 22-18v-8M64 68v18" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="42" cy="36" r="10" fill="white"/><circle cx="86" cy="36" r="10" fill="white"/><circle cx="64" cy="94" r="10" fill="white"/></svg>`;

async function badge(
  source: string,
  output: string,
  size: number,
  badgeSize: number,
  margin: number,
) {
  const badgeImage = await sharp(Buffer.from(glyph)).resize(badgeSize, badgeSize).png().toBuffer();
  await sharp(source)
    .resize(size, size, { fit: "contain" })
    .composite([
      { input: badgeImage, left: size - badgeSize - margin, top: size - badgeSize - margin },
    ])
    .png()
    .toFile(output);
}

await mkdir(outputDir, { recursive: true });
await badge(
  path.resolve(mobileRoot, "../../assets/prod/black-ios-1024.png"),
  path.join(outputDir, "ios-icon.png"),
  1024,
  220,
  28,
);
await badge(
  path.join(mobileRoot, "assets/android-icon-foreground.png"),
  path.join(outputDir, "android-adaptive-foreground.png"),
  1024,
  150,
  187,
);
