#!/usr/bin/env node

/**
 * Generate social media shareable images for conference speakers
 * Uses AI-generated background with speaker photo + text overlay
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
 * Create text overlay SVG
 * Layout: Branding top-right, speaker info right side, CTA bottom
 */
function createTextOverlay(speakerName, talkTitle, organization, eventName, eventDate, discountCode) {
  const titleLines = wrapText(talkTitle, 32);
  const lineHeight = 32;
  const textX = 420; // Right of speaker photo

  const titleSvg = titleLines
    .slice(0, 3)
    .map((line, i) => `<text x="${textX}" y="${250 + i * lineHeight}" font-family="Arial, sans-serif" font-size="22" font-weight="500" fill="#fbbf24" filter="url(#shadow)">${escapeXml(line)}</text>`)
    .join("\n");

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/>
        </filter>
      </defs>

      <!-- Top right: Event branding -->
      <text x="${WIDTH - 40}" y="45" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="end" filter="url(#shadow)" letter-spacing="3">LLMDAY ${escapeXml(eventName)}</text>
      <text x="${WIDTH - 40}" y="72" font-family="Arial, sans-serif" font-size="16" fill="rgba(255,255,255,0.9)" text-anchor="end" filter="url(#shadow)">${escapeXml(eventDate)}</text>

      <!-- Right side: Speaker info (in the sky area) -->
      <text x="${textX}" y="170" font-family="Arial, sans-serif" font-size="44" font-weight="bold" fill="white" filter="url(#shadow)">${escapeXml(speakerName)}</text>
      <text x="${textX}" y="205" font-family="Arial, sans-serif" font-size="20" fill="rgba(255,255,255,0.9)" filter="url(#shadow)">${escapeXml(organization || "")}</text>

      <!-- Talk title in gold -->
      ${titleSvg}

      <!-- Bottom: CTA with semi-transparent background -->
      <rect x="${textX - 15}" y="${HEIGHT - 70}" width="600" height="45" rx="6" fill="rgba(0,0,0,0.6)"/>
      <text x="${textX}" y="${HEIGHT - 40}" font-family="Arial, sans-serif" font-size="18" fill="white">Save 30% with code <tspan font-weight="bold" fill="#fbbf24">${escapeXml(discountCode)}</tspan> at <tspan font-weight="bold">llmday.com</tspan></text>
    </svg>
  `;
}

/**
 * Generate speaker card
 */
async function generateSpeakerCard(speaker, talkTitle, eventId, eventName, eventDate, discountCode) {
  const bgPath = path.join(ASSETS_DIR, "speaker-bg.png");
  const photoPath = path.join(SPEAKERS_DIR, speaker.photo);

  if (!fs.existsSync(bgPath)) {
    console.warn(`  Warning: Background not found: ${bgPath}`);
    return null;
  }

  if (!fs.existsSync(photoPath)) {
    console.warn(`  Warning: Photo not found for ${speaker.name}: ${photoPath}`);
    return null;
  }

  // 1. Start with AI-generated background, resize to target dimensions
  let baseImage = await sharp(bgPath)
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  // 2. Create circular speaker photo
  const photoSize = 320;
  const photoBuffer = await sharp(photoPath)
    .resize(photoSize, photoSize, { fit: "cover", position: "top" })
    .png()
    .toBuffer();

  // Create circular mask
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

  // 3. Add subtle glow/border around photo
  const glowSize = photoSize + 20;
  const photoWithGlow = await sharp({
    create: {
      width: glowSize,
      height: glowSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      // Gold glow circle behind
      {
        input: Buffer.from(`
          <svg width="${glowSize}" height="${glowSize}">
            <circle cx="${glowSize/2}" cy="${glowSize/2}" r="${glowSize/2}" fill="rgba(251,191,36,0.3)"/>
          </svg>
        `),
        left: 0,
        top: 0
      },
      // The actual photo
      {
        input: circularPhoto,
        left: 10,
        top: 10
      }
    ])
    .png()
    .toBuffer();

  // 4. Composite photo onto background (left side, mid-height)
  baseImage = await sharp(baseImage)
    .composite([{ input: photoWithGlow, left: 40, top: (HEIGHT - glowSize) / 2 - 30 }])
    .png()
    .toBuffer();

  // 5. Create and composite text overlay
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
