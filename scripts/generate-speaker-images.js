#!/usr/bin/env node

/**
 * Generate social media shareable images for conference speakers
 * Clean, simple design with clear hierarchy
 *
 * LESSONS APPLIED:
 * - Only 3 font sizes (20px header/footer, 32px title, 48px name)
 * - No yellow/amber accents
 * - Photo background stays as-is (part of design)
 * - Strict left alignment
 * - No text over buildings
 * - Clear REGISTER call to action
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
const ASSETS_DIR = path.join(ROOT_DIR, "src/assets");
const OUTPUT_DIR = path.join(ROOT_DIR, "dist/speaker-cards");

const WIDTH = 1200;
const HEIGHT = 630;
const WHITE = "#FFFFFF";

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
 * Text overlay with only 3 font sizes:
 * - 20px: header and footer
 * - 32px: talk title
 * - 48px: speaker name (hero)
 */
function createTextOverlay(speakerName, talkTitle, organization, eventName, eventDate, discountCode) {
  const LEFT_MARGIN = 400;
  // Shorter lines to avoid overlapping with buildings
  const titleLines = wrapText(talkTitle, 22);

  const titleSvg = titleLines
    .slice(0, 4)
    .map((line, i) => `<text x="${LEFT_MARGIN}" y="${280 + i * 38}" font-family="Arial, sans-serif" font-size="28" fill="${WHITE}">${escapeXml(line)}</text>`)
    .join("\n");

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <!-- HEADER: Event branding - 20px -->
      <text x="${LEFT_MARGIN}" y="60" font-family="Arial, sans-serif" font-size="20" fill="${WHITE}">LLMDAY ${escapeXml(eventName)} | ${escapeXml(eventDate)}</text>

      <!-- HERO: Speaker name - 44px -->
      <text x="${LEFT_MARGIN}" y="150" font-family="Arial, sans-serif" font-size="44" font-weight="bold" fill="${WHITE}">${escapeXml(speakerName)}</text>

      <!-- Organization - 20px (same as header) -->
      <text x="${LEFT_MARGIN}" y="185" font-family="Arial, sans-serif" font-size="20" fill="${WHITE}" opacity="0.9">${escapeXml(organization || "")}</text>

      <!-- BODY: Talk title - 28px, tighter -->
      ${titleSvg}

      <!-- FOOTER: Clear CTA - positioned ABOVE buildings -->
      <text x="${LEFT_MARGIN}" y="470" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="${WHITE}">REGISTER at llmday.com | Code ${escapeXml(discountCode)} for 30% off</text>
    </svg>
  `;
}

/**
 * Generate speaker card - simple and clean
 */
async function generateSpeakerCard(speaker, talkTitle, eventId, eventName, eventDate, discountCode) {
  const bgPath = path.join(ASSETS_DIR, "speaker-card-bg.png");
  const photoPath = path.join(SPEAKERS_DIR, speaker.photo);

  if (!fs.existsSync(bgPath)) {
    console.warn(`  Warning: Background not found: ${bgPath}`);
    return null;
  }

  if (!fs.existsSync(photoPath)) {
    console.warn(`  Warning: Photo not found for ${speaker.name}: ${photoPath}`);
    return null;
  }

  // 1. Background
  let baseImage = await sharp(bgPath)
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  // 2. Speaker photo - simple circle with white border, keep original background
  const photoSize = 260;
  const borderSize = 4;
  const totalSize = photoSize + borderSize * 2;

  const photoBuffer = await sharp(photoPath)
    .resize(photoSize, photoSize, { fit: "cover", position: "top" })
    .png()
    .toBuffer();

  // Circle mask
  const circleMask = Buffer.from(`
    <svg width="${photoSize}" height="${photoSize}">
      <circle cx="${photoSize/2}" cy="${photoSize/2}" r="${photoSize/2}" fill="white"/>
    </svg>
  `);

  const circularPhoto = await sharp(photoBuffer)
    .composite([{
      input: await sharp(circleMask).png().toBuffer(),
      blend: "dest-in"
    }])
    .png()
    .toBuffer();

  // White border circle
  const borderCircle = Buffer.from(`
    <svg width="${totalSize}" height="${totalSize}">
      <circle cx="${totalSize/2}" cy="${totalSize/2}" r="${totalSize/2}" fill="white"/>
    </svg>
  `);

  const photoWithBorder = await sharp(Buffer.from(borderCircle))
    .png()
    .toBuffer()
    .then(bg => sharp(bg)
      .composite([{
        input: circularPhoto,
        left: borderSize,
        top: borderSize
      }])
      .png()
      .toBuffer()
    );

  // Place photo on left - aligned vertically with text
  baseImage = await sharp(baseImage)
    .composite([{ input: photoWithBorder, left: 60, top: 160 }])
    .png()
    .toBuffer();

  // 3. Text overlay
  const textOverlay = createTextOverlay(speaker.name, talkTitle, speaker.organization, eventName, eventDate, discountCode);
  const textBuffer = await sharp(Buffer.from(textOverlay)).png().toBuffer();

  baseImage = await sharp(baseImage)
    .composite([{ input: textBuffer, left: 0, top: 0 }])
    .png()
    .toBuffer();

  return baseImage;
}

function getEventInfo(eventId) {
  const eventMap = {
    "2026-warsaw-q1": { name: "WARSAW", date: "February 12, 2026" },
    "2026-london-q2": { name: "LONDON", date: "Q2 2026" },
    "2026-nyc-q1": { name: "NYC", date: "Q1 2026" },
  };
  return eventMap[eventId] || { name: eventId.toUpperCase().replace(/-Q\d$/, ""), date: "" };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let eventId = "2026-warsaw-q1";
  let discountCode = "LLM30";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--discount" && args[i + 1]) {
      discountCode = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      eventId = args[i];
    }
  }

  return { eventId, discountCode };
}

async function main() {
  const { eventId, discountCode } = parseArgs();
  const eventInfo = getEventInfo(eventId);

  console.log(`\nGenerating speaker cards for ${eventId}...`);
  console.log(`Event: LLMDAY ${eventInfo.name} - ${eventInfo.date}`);
  console.log(`Discount code: ${discountCode}`);
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
        const imageBuffer = await generateSpeakerCard(
          speaker,
          frontmatter.title,
          eventId,
          eventInfo.name,
          eventInfo.date,
          discountCode
        );

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
