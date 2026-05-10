import fs from "node:fs/promises";
import path from "node:path";

import { PDFParse } from "pdf-parse";

function parsePages(raw) {
  if (!raw) {
    throw new Error("Expected a comma-separated page list like 35,36,37.");
  }

  return raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

const [, , pdfPathArg, outputDirArg, pageListArg, scaleArg] = process.argv;

if (!pdfPathArg || !outputDirArg || !pageListArg) {
  throw new Error(
    "Usage: node scripts/export_pdf_pages.mjs <pdfPath> <outputDir> <pagesCsv> [scale]",
  );
}

const pdfPath = path.resolve(pdfPathArg);
const outputDir = path.resolve(outputDirArg);
const pages = parsePages(pageListArg);
const scale = Number.parseFloat(scaleArg ?? "2");

await fs.mkdir(outputDir, { recursive: true });

const buffer = await fs.readFile(pdfPath);
const parser = new PDFParse({ data: buffer });

try {
  for (const pageNumber of pages) {
    const screenshot = await parser.getScreenshot({
      partial: [pageNumber],
      scale,
    });
    const imageBytes = screenshot.pages[0]?.data;
    if (!imageBytes) {
      throw new Error(`Could not render page ${pageNumber}.`);
    }

    const outputPath = path.join(
      outputDir,
      `page-${String(pageNumber).padStart(3, "0")}.png`,
    );
    await fs.writeFile(outputPath, Buffer.from(imageBytes));
    console.log(outputPath);
  }
} finally {
  await parser.destroy();
}
