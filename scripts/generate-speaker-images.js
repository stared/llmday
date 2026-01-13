#!/usr/bin/env node

/**
 * Generate social media shareable images for conference speakers
 * Usage: node scripts/generate-speaker-images.js [event-id] [--discount CODE]
 * Example: node scripts/generate-speaker-images.js 2026-warsaw-q1 --discount SPEAKER20
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

// Image dimensions (optimal for LinkedIn/Twitter)
const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Parse frontmatter from markdown file
 */
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

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wrap text to fit within a certain width
 */
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
 * Create clean SVG overlay - matches LLMDAY brand
 */
function createTextOverlay(speakerName, talkTitle, organization, eventName, eventDate, discountCode) {
  const titleLines = wrapText(talkTitle, 38);
  const lineHeight = 36;

  const titleSvg = titleLines
    .slice(0, 3)
    .map((line, i) => `<text x="420" y="${340 + i * lineHeight}" font-family="Arial, sans-serif" font-size="28" fill="white">${escapeXml(line)}</text>`)
    .join("\n");

  const discountSection = discountCode ? `
    <text x="420" y="560" font-family="Arial, sans-serif" font-size="20" fill="white">Use code: <tspan font-weight="bold">${escapeXml(discountCode)}</tspan></text>
  ` : "";

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <!-- Green background -->
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#059669"/>

      <!-- LLMDAY branding -->
      <text x="60" y="70" font-family="Arial, sans-serif" font-size="42" font-weight="bold" fill="white">LLMDAY</text>
      <text x="245" y="70" font-family="Arial, sans-serif" font-size="42" fill="white">${escapeXml(eventName)}</text>

      <!-- Tagline -->
      <text x="60" y="105" font-family="Arial, sans-serif" font-size="20" fill="rgba(255,255,255,0.85)">Large Language Models, AI and ML</text>

      <!-- Date -->
      <text x="${WIDTH - 60}" y="70" font-family="Arial, sans-serif" font-size="24" fill="white" text-anchor="end">${escapeXml(eventDate)}</text>

      <!-- Speaker photo circle background -->
      <circle cx="200" cy="380" r="150" fill="rgba(255,255,255,0.1)"/>

      <!-- Speaker name -->
      <text x="420" y="220" font-family="Arial, sans-serif" font-size="42" font-weight="bold" fill="white">${escapeXml(speakerName)}</text>

      <!-- Organization -->
      <text x="420" y="260" font-family="Arial, sans-serif" font-size="22" fill="rgba(255,255,255,0.85)">${escapeXml(organization || "")}</text>

      <!-- Talk title -->
      ${titleSvg}

      ${discountSection}

      <!-- Bottom: website -->
      <text x="60" y="${HEIGHT - 30}" font-family="Arial, sans-serif" font-size="18" fill="rgba(255,255,255,0.7)">llmday.com</text>
    </svg>
  `;
}

/**
 * Generate speaker card image
 */
async function generateSpeakerCard(speaker, talkTitle, eventId, eventName, eventDate, discountCode) {
  const photoPath = path.join(SPEAKERS_DIR, speaker.photo);

  if (!fs.existsSync(photoPath)) {
    console.warn(`  Warning: Photo not found for ${speaker.name}: ${photoPath}`);
    return null;
  }

  // Create the text overlay SVG
  const textOverlay = createTextOverlay(
    speaker.name,
    talkTitle,
    speaker.organization,
    eventName,
    eventDate,
    discountCode
  );

  // Process speaker photo - circular crop
  const photoBuffer = await sharp(photoPath)
    .resize(280, 280, { fit: "cover", position: "top" })
    .toBuffer();

  // Create circular mask
  const circleMask = Buffer.from(`
    <svg width="280" height="280">
      <circle cx="140" cy="140" r="140" fill="white"/>
    </svg>
  `);

  const circularPhoto = await sharp(photoBuffer)
    .composite([{
      input: await sharp(circleMask).toBuffer(),
      blend: "dest-in"
    }])
    .png()
    .toBuffer();

  // Create the base image with the SVG overlay
  const baseImage = await sharp(Buffer.from(textOverlay))
    .png()
    .toBuffer();

  // Composite the circular photo onto the base
  const finalImage = await sharp(baseImage)
    .composite([{
      input: circularPhoto,
      left: 60,
      top: 240
    }])
    .png()
    .toBuffer();

  return finalImage;
}

/**
 * Get event info from event ID
 */
function getEventInfo(eventId) {
  const eventMap = {
    "2026-warsaw-q1": { name: "WARSAW", date: "February 12, 2026" },
    "2026-london-q2": { name: "LONDON", date: "Q2 2026" },
    "2026-nyc-q1": { name: "NYC", date: "Q1 2026" },
  };
  return eventMap[eventId] || { name: eventId.toUpperCase().replace(/-Q\d$/, ""), date: "" };
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let eventId = "2026-warsaw-q1";
  let discountCode = null;

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

/**
 * Main function
 */
async function main() {
  const { eventId, discountCode } = parseArgs();
  const eventInfo = getEventInfo(eventId);

  console.log(`\nGenerating speaker cards for ${eventId}...`);
  console.log(`Event: LLMDAY ${eventInfo.name} - ${eventInfo.date}`);
  if (discountCode) {
    console.log(`Discount code: ${discountCode}`);
  }
  console.log("");

  const talksDir = path.join(TALKS_DIR, eventId);

  if (!fs.existsSync(talksDir)) {
    console.error(`Error: Talks directory not found: ${talksDir}`);
    process.exit(1);
  }

  // Create output directory
  const outputDir = path.join(OUTPUT_DIR, eventId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get all talk files
  const talkFiles = fs.readdirSync(talksDir).filter(f => f.endsWith(".md"));

  console.log(`Found ${talkFiles.length} talks\n`);

  let generated = 0;
  let skipped = 0;

  for (const talkFile of talkFiles) {
    const talkPath = path.join(talksDir, talkFile);
    const content = fs.readFileSync(talkPath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter || !frontmatter.speakers || frontmatter.speakers.length === 0) {
      console.log(`  Skipping ${talkFile}: No speaker info`);
      skipped++;
      continue;
    }

    for (const speaker of frontmatter.speakers) {
      if (!speaker.photo) {
        console.log(`  Skipping ${speaker.name}: No photo`);
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
