import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { TESSDATA_DIR, TMP_DIR, ensureStorageDirs, fileExists } from "@/lib/storage";
import type { OcrPage } from "@/lib/text";

const execFileAsync = promisify(execFile);
const OFFICIAL_BENGALI_MODEL =
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/ben.traineddata";
const DEFAULT_GEMINI_OCR_MODEL =
  process.env.GEMINI_OCR_MODEL ?? "models/gemini-3.1-flash-lite";

function getSystemTesseractPath() {
  return process.env.TESSERACT_PATH ?? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
}

async function ensureTessdataFile(fileName: string) {
  const targetPath = path.join(TESSDATA_DIR, fileName);
  if (await fileExists(targetPath)) {
    return targetPath;
  }

  const systemFile = path.join("C:\\Program Files\\Tesseract-OCR\\tessdata", fileName);
  if (await fileExists(systemFile)) {
    await fs.copyFile(systemFile, targetPath);
    return targetPath;
  }

  if (fileName === "ben.traineddata") {
    const response = await fetch(OFFICIAL_BENGALI_MODEL);
    if (!response.ok) {
      throw new Error("Could not download Bengali OCR model.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(targetPath, buffer);
    return targetPath;
  }

  throw new Error(`Missing Tesseract asset: ${fileName}`);
}

async function ensureOcrAssets() {
  await ensureStorageDirs();

  const tesseractPath = getSystemTesseractPath();
  if (!(await fileExists(tesseractPath))) {
    throw new Error("Tesseract is not installed on this machine.");
  }

  await Promise.all([
    ensureTessdataFile("eng.traineddata"),
    ensureTessdataFile("osd.traineddata"),
    ensureTessdataFile("ben.traineddata"),
  ]);

  return tesseractPath;
}

async function runGeminiOcrWorker(pdfPath: string, outputPath: string) {
  const workerPath = path.join(process.cwd(), "scripts", "gemini-ocr-worker.mjs");
  await execFileAsync(process.execPath, [workerPath, pdfPath, outputPath, TMP_DIR], {
    env: {
      ...process.env,
      GEMINI_OCR_MODEL: DEFAULT_GEMINI_OCR_MODEL,
    },
    maxBuffer: 1024 * 1024 * 12,
  });
}

async function runOcrCleanupWorker(inputPath: string, outputPath: string) {
  const workerPath = path.join(process.cwd(), "scripts", "ocr-cleanup-worker.mjs");
  await execFileAsync(process.execPath, [workerPath, inputPath, outputPath], {
    env: {
      ...process.env,
      GEMINI_OCR_MODEL: DEFAULT_GEMINI_OCR_MODEL,
    },
    maxBuffer: 1024 * 1024 * 12,
  });
}

async function runTesseractOcrWorker(pdfPath: string, outputPath: string) {
  const tesseractPath = await ensureOcrAssets();
  const workerPath = path.join(process.cwd(), "scripts", "ocr-worker.mjs");

  await execFileAsync(
    process.execPath,
    [workerPath, pdfPath, outputPath, TMP_DIR, TESSDATA_DIR, tesseractPath],
    {
      maxBuffer: 1024 * 1024 * 4,
    },
  );
}

export async function ocrPdfToPages(pdfPath: string) {
  await ensureStorageDirs();
  const outputPath = path.join(
    TMP_DIR,
    `${path.basename(pdfPath, path.extname(pdfPath))}-ocr.json`,
  );
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const ocrMode = process.env.FSQUEST_OCR_MODE?.trim().toLowerCase() ?? "tesseract-first";
  const cleanupEnabled = process.env.FSQUEST_OCR_AI_CLEANUP?.trim().toLowerCase() !== "off";

  if (ocrMode === "gemini-image" && geminiApiKey) {
    await runGeminiOcrWorker(pdfPath, outputPath);
  } else {
    await runTesseractOcrWorker(pdfPath, outputPath);

    if (geminiApiKey && cleanupEnabled) {
      const cleanupOutputPath = path.join(
        TMP_DIR,
        `${path.basename(pdfPath, path.extname(pdfPath))}-ocr-cleaned.json`,
      );
      await runOcrCleanupWorker(outputPath, cleanupOutputPath).catch((error) => {
        console.warn("AI OCR cleanup skipped; keeping Tesseract output.", error);
      });

      if (await fileExists(cleanupOutputPath)) {
        await fs.copyFile(cleanupOutputPath, outputPath);
        await fs.unlink(cleanupOutputPath).catch(() => undefined);
      }
    }
  }

  const payload = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
    pageCount: number;
    pages: OcrPage[];
    extractionMethod: string;
  };
  await fs.unlink(outputPath).catch(() => undefined);

  return payload;
}
