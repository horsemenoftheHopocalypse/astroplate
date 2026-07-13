// Imports Brewer Spotlight entries from a CSV exported from the club's
// Google Sheet (Sheets -> File -> Download -> Comma Separated Values).
//
// Usage:
//   node scripts/import-brewer-spotlights.js path/to/export.csv
//   yarn import-brewer-spotlights path/to/export.csv
//
// The sheet is a Google Form response export, so its column headers are the
// literal form question text (which may not match what's below verbatim).
// HEADER_MAP matches columns by keyword rather than exact string so small
// wording differences don't break the import — adjust the keyword lists
// here if a column isn't being picked up (check the "unmapped columns"
// warning the script prints after each run).
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import matter from "gray-matter";
import { slug } from "github-slugger";

const OUT_DIR = "src/content/brewer-spotlights";
const IMAGES_DIR = "public/images";
const FALLBACK_AVATAR = "/images/avatar.png";

const HEADER_MAP = {
  name: ["name"],
  designation: ["designation", "role", "title"],
  date: ["interview date"],
  photo: ["photo", "picture", "image", "avatar"],
  first_batch: ["first batch"],
  favorite_beer: ["favorite beer", "favourite beer"],
  biggest_fail: ["biggest", "fail"],
  go_to_beer: ["go-to", "go to", "commercial beer"],
  fermenter_now: ["fermenter"],
  favorite_style: ["bjcp", "style"],
  brewery_setup: ["brewery", "set-up", "setup"],
  why_homebrew: ["why", "homebrew"],
  horsemen_highlight: ["horsemen"],
  fun_facts: ["fun fact", "other fun", "anything else"],
};

function normalizeHeader(header) {
  return header.trim().toLowerCase();
}

function matchField(header) {
  const normalized = normalizeHeader(header);
  for (const [field, keywords] of Object.entries(HEADER_MAP)) {
    if (keywords.some((kw) => normalized.includes(kw))) {
      return field;
    }
  }
  return null;
}

function formatDate(rawDate) {
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function driveDownloadUrl(url) {
  const match = url.match(/drive\.google\.com\/.*[?&/]id=([\w-]+)/) ||
    url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (!match) return url;
  return `https://drive.google.com/uc?export=download&id=${match[1]}`;
}

async function downloadPhoto(url, slugName, warnings) {
  if (!url) return FALLBACK_AVATAR;

  const downloadUrl = driveDownloadUrl(url);
  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error(
        `expected an image, got "${contentType}" (the file is likely not shared as "Anyone with the link")`,
      );
    }
    const extFromType = contentType.split("/")[1]?.split(";")[0];
    const extFromUrl = path.extname(new URL(url).pathname).replace(".", "");
    const ext = extFromUrl || extFromType || "jpg";

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const filename = `${slugName}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
    return `/images/${filename}`;
  } catch (err) {
    warnings.push(`${slugName}: photo download failed (${err.message}), using fallback avatar`);
    return FALLBACK_AVATAR;
  }
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node scripts/import-brewer-spotlights.js <path-to-exported.csv>");
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true });

  if (rows.length === 0) {
    console.error("No rows found in CSV.");
    process.exit(1);
  }

  const headers = Object.keys(rows[0]);
  const fieldByHeader = new Map(headers.map((h) => [h, matchField(h)]));
  const timestampHeader = headers.find(
    (h) => normalizeHeader(h) === "timestamp",
  );
  const unmappedHeaders = headers.filter(
    (h) => !fieldByHeader.get(h) && h !== timestampHeader,
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const warnings = [];
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const byField = {};
    for (const [header, value] of Object.entries(row)) {
      const field = fieldByHeader.get(header);
      if (field && value?.trim()) {
        byField[field] = value.trim();
      }
    }

    if (!byField.name) {
      skipped += 1;
      warnings.push(`Skipped a row with no name (columns: ${Object.keys(row).join(", ")})`);
      continue;
    }

    const slugName = slug(byField.name);
    const avatar = await downloadPhoto(byField.photo, slugName, warnings);

    const timestampDate = timestampHeader
      ? formatDate(row[timestampHeader])
      : null;

    const entry = {
      name: byField.name,
      avatar,
      designation: byField.designation || "Homebrewer",
      date:
        byField.date ||
        timestampDate ||
        formatDate(new Date()),
      first_batch: byField.first_batch,
      favorite_beer: byField.favorite_beer,
      biggest_fail: byField.biggest_fail,
      go_to_beer: byField.go_to_beer,
      fermenter_now: byField.fermenter_now,
      favorite_style: byField.favorite_style,
      brewery_setup: byField.brewery_setup,
      why_homebrew: byField.why_homebrew,
      horsemen_highlight: byField.horsemen_highlight,
      fun_facts: byField.fun_facts,
    };

    // drop unanswered optional fields rather than writing empty strings
    for (const key of Object.keys(entry)) {
      if (entry[key] === undefined) delete entry[key];
    }

    const outPath = path.join(OUT_DIR, `${slugName}.md`);
    fs.writeFileSync(outPath, matter.stringify("", entry));
    created += 1;
    console.log(`wrote ${outPath}`);
  }

  console.log("\n--- Summary ---");
  console.log(`${created} spotlight file(s) written, ${skipped} row(s) skipped.`);
  if (unmappedHeaders.length) {
    console.log(`Unmapped columns (ignored — add keywords to HEADER_MAP if these matter): ${unmappedHeaders.join(", ")}`);
  }
  if (warnings.length) {
    console.log("Warnings:");
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
}

main();
