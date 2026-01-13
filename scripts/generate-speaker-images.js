#!/usr/bin/env node

/**
 * Generate social media shareable images for conference speakers
 * Simple approach: banner as base, speaker photo + text on top
 */

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, "..");
const TALKS_DIR = path.join(ROOT_DIR, "src/content/talks");
const SPEAKERS_DIR = path.join(ROOT_DIR, "src/assets/speakers");
const EVENTS_DIR = path.join(ROOT_DIR, "src/assets/events");
const OUTPUT_DIR = path.join(ROOT_DIR, "dist/speaker-cards");

const WIDTH = 1200;
const HEIGHT = 630;

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = {};
  const lines = match[1].split("\n");
  let inSpeakers = false;
  let currentSpeaker = null;

  for (const line of lines) {
    if (line.startsWith("title:")) {
      frontmatter.title = line.replace("title:", "").trim().replace(/^"|"$/g, "");
    } else if (line === "speakers:") {
      inSpeakers = true;
      frontmatter.speakers = [];
    } else if (inSpeakers && line.trim().startsWith("- name:")) {
      if (currentSpeaker) frontmatter.speakers.push(currentSpeaker);
      currentSpeaker = { name: line.replace("- name:", "").trim().replace(/^"|"$/g, "") };
    } else if (inSpeakers && currentSpeaker && line.trim().startsWith("organization:")) {
      currentSpeaker.organization = line.replace(/.*organization:/, "").trim().replace(/^"|"$/g, "");
    } else if (inSpeakers && currentSpeaker && line.trim().startsWith("photo:")) {
      currentSpeaker.photo = line.replace(/.*photo:/, "").trim().replace(/^"|"$/g, "");
    }
  }
  if (currentSpeaker) frontmatter.speakers.push(currentSpeaker);

  return frontmatter;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

/**
 * Create text overlay SVG - dark panel covers photo + text area, skyline visible on right
 */
function createTextOverlay(speakerName, talkTitle, organization) {
  const titleLines = wrapText(talkTitle, 28);
  const lineHeight = 34;
  const textX = 460;

  const titleSvg = titleLines
    .slice(0, 3)
    .map((line, i) => `<text x="${textX}" y="${340 + i * lineHeight}" font-family="Arial, sans-serif" font-size="22" fill="white">${escapeXml(line)}</text>`)
    .join("\n");

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <!-- Solid dark panel covering left 75% for photo + text, skyline visible on right -->
      <rect width="900" height="${HEIGHT}" fill="#111111"/>

      <!-- SPEAKER badge -->
      <rect x="${textX}" y="180" width="100" height="28" rx="4" fill="#fbbf24"/>
      <text x="${textX + 50}" y="199" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#111" text-anchor="middle">SPEAKER</text>

      <!-- Speaker name - THE HERO -->
      <text x="${textX}" y="250" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="white">${escapeXml(speakerName)}</text>
      <text x="${textX}" y="285" font-family="Arial, sans-serif" font-size="18" fill="rgba(255,255,255,0.9)">${escapeXml(organization || "")}</text>

      <!-- Talk title -->
      ${titleSvg}

      <!-- Website -->
      <text x="${textX}" y="${HEIGHT - 40}" font-family="Arial, sans-serif" font-size="16" fill="rgba(255,255,255,0.8)">llmday.com</text>
    </svg>
  `;
}

/**
 * Generate speaker card
 */
async function generateSpeakerCard(speaker, talkTitle, eventId) {
  const bannerPath = path.join(EVENTS_DIR, `llmday-${eventId}.png`);
  const photoPath = path.join(SPEAKERS_DIR, speaker.photo);

  if (!fs.existsSync(bannerPath)) {
    console.warn(`  Warning: Banner not found: ${bannerPath}`);
    return null;
  }

  if (!fs.existsSync(photoPath)) {
    console.warn(`  Warning: Photo not found for ${speaker.name}: ${photoPath}`);
    return null;
  }

  // 1. Start with conference banner as base, resize to target dimensions
  let baseImage = await sharp(bannerPath)
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  // 2. Create text overlay (includes dark panel on left)
  const textOverlay = createTextOverlay(speaker.name, talkTitle, speaker.organization);
  const textBuffer = await sharp(Buffer.from(textOverlay)).png().toBuffer();

  // 3. Composite text overlay on top of banner
  baseImage = await sharp(baseImage)
    .composite([{ input: textBuffer, left: 0, top: 0 }])
    .png()
    .toBuffer();

  // 4. Speaker photo - resize to fit left panel
  const photoBuffer = await sharp(photoPath)
    .resize(380, HEIGHT - 40, { fit: "cover", position: "top" })
    .png()
    .toBuffer();

  // 5. Composite speaker photo on the dark panel
  baseImage = await sharp(baseImage)
    .composite([{ input: photoBuffer, left: 20, top: 20 }])
    .png()
    .toBuffer();

  return baseImage;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let eventId = "2026-warsaw-q1";

  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      eventId = args[i];
    }
  }

  return { eventId };
}

async function main() {
  const { eventId } = parseArgs();

  console.log(`\nGenerating speaker cards for ${eventId}...`);
  console.log("");

  const talksDir = path.join(TALKS_DIR, eventId);
  if (!fs.existsSync(talksDir)) {
    console.error(`Error: Talks directory not found: ${talksDir}`);
    process.exit(1);
  }

  const outputDir = path.join(OUTPUT_DIR, eventId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const talkFiles = fs.readdirSync(talksDir).filter(f => f.endsWith(".md"));
  console.log(`Found ${talkFiles.length} talks\n`);

  let generated = 0;
  let skipped = 0;

  for (const talkFile of talkFiles) {
    const talkPath = path.join(talksDir, talkFile);
    const content = fs.readFileSync(talkPath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter || !frontmatter.speakers || frontmatter.speakers.length === 0) {
      skipped++;
      continue;
    }

    for (const speaker of frontmatter.speakers) {
      if (!speaker.photo) {
        skipped++;
        continue;
      }

      const outputFilename = `${speaker.name.toLowerCase().replace(/\s+/g, "-")}.png`;
      const outputPath = path.join(outputDir, outputFilename);

      console.log(`  Generating: ${speaker.name}`);

      try {
        const imageBuffer = await generateSpeakerCard(speaker, frontmatter.title, eventId);

        if (imageBuffer) {
          fs.writeFileSync(outputPath, imageBuffer);
          console.log(`    Saved: ${outputFilename}`);
          generated++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`    Error: ${error.message}`);
        skipped++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Generated: ${generated} images`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Output: ${outputDir}`);
  console.log(`========================================\n`);
}

main().catch(console.error);
