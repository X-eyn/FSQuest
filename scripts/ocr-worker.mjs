import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { PDFParse } from "pdf-parse";

const execFileAsync = promisify(execFile);

const [, , pdfPath, outputPath, tmpDir, tessdataDir, tesseractPath] = process.argv;

if (!pdfPath || !outputPath || !tmpDir || !tessdataDir || !tesseractPath) {
  throw new Error("OCR worker missing required arguments.");
}

function cleanOcrText(text) {
  return text
    .normalize("NFC")
    .replace(/\r/g, "")
    .replace(/[|¦]/g, "।")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      const hasBangla = /[\u0980-\u09FF]/u.test(line);
      const looksLikeOnlyNumbers = /^[\d০-৯\s.,:;=+\-_/()%]+$/u.test(line);
      return hasBangla || !looksLikeOnlyNumbers;
    })
    .join("\n");
}

async function ocrImage(imagePath) {
  const { stdout } = await execFileAsync(
    tesseractPath,
    [
      imagePath,
      "stdout",
      "-l",
      "ben+eng",
      "--psm",
      "6",
      "--tessdata-dir",
      tessdataDir,
    ],
    {
      maxBuffer: 1024 * 1024 * 12,
    },
  );

  return cleanOcrText(stdout);
}

await fs.mkdir(tmpDir, { recursive: true });
const buffer = await fs.readFile(pdfPath);
const parser = new PDFParse({ data: buffer });

try {
  const info = await parser.getInfo({ parsePageInfo: true });
  const pages = [];
  const fileStem = path.basename(pdfPath, path.extname(pdfPath));

  for (let pageNumber = 1; pageNumber <= info.total; pageNumber += 1) {
    const screenshot = await parser.getScreenshot({
      partial: [pageNumber],
      scale: 2,
    });
    const imageBytes = screenshot.pages[0]?.data;
    const tempImagePath = path.join(tmpDir, `${fileStem}-${pageNumber}.png`);

    await fs.writeFile(tempImagePath, Buffer.from(imageBytes));
    const text = await ocrImage(tempImagePath);
    pages.push({ pageNumber, text });
    await fs.unlink(tempImagePath).catch(() => undefined);
  }

  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        pageCount: info.total,
        pages,
        extractionMethod: "tesseract-ben+eng",
      },
      null,
      2,
    ),
    "utf8",
  );
} finally {
  await parser.destroy();
}
