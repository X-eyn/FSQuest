import fs from "node:fs/promises";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  throw new Error("OCR cleanup worker missing required arguments.");
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required for OCR cleanup.");
}

const DEFAULT_GEMINI_OCR_MODEL =
  process.env.GEMINI_OCR_MODEL?.trim() || "models/gemini-3.1-flash-lite";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const PAGE_LIMIT = Number(process.env.FSQUEST_OCR_CLEANUP_PAGE_LIMIT ?? 24);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasBangla(text) {
  return /[\u0980-\u09FF]/u.test(text);
}

function needsCleanup(text) {
  const banglaCount = (text.match(/[\u0980-\u09FF]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return (
    hasBangla(text) &&
    (/[�ÃÂ]|AOA|sy|Tu Pe|BBs|_{2,}|[0-9০-৯]{6,}/u.test(text) ||
      latinCount > Math.max(3, Math.floor(banglaCount / 5)))
  );
}

function cleanText(text) {
  return text
    .normalize("NFC")
    .replace(/\r/g, "")
    .replace(/[|¦]/g, "।")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function generateCleanup(text) {
  const prompt = `Lightly clean this Bangla OCR text from one primary-school textbook page.

Rules:
- Keep the same content and reading order.
- Fix obvious OCR character glitches only when clear from local context.
- Preserve exercise blanks, unfinished answer lines, option banks, and matching tasks.
- Do not solve, fill, summarize, expand, translate, or add new textbook content.
- Return only the cleaned OCR text.

OCR text:
${text.slice(0, 5000)}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0 },
  });

  let response = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${DEFAULT_GEMINI_OCR_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );

    if (response.ok || !RETRY_STATUSES.has(response.status) || attempt === 3) {
      break;
    }

    await sleep(900 * attempt);
  }

  if (!response?.ok) {
    throw new Error(`cleanup status ${response?.status ?? "unknown"}`);
  }

  const payload = await response.json();
  const cleaned =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text ?? "")
      .join("")
      .trim() ?? "";

  return cleaned ? cleanText(cleaned) : text;
}

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
let cleanedCount = 0;
let skippedCount = 0;

for (const page of payload.pages ?? []) {
  if (cleanedCount >= PAGE_LIMIT || !needsCleanup(page.text ?? "")) {
    continue;
  }

  try {
    page.text = await generateCleanup(page.text);
    page.aiCleanupUsed = true;
    cleanedCount += 1;
  } catch (error) {
    page.aiCleanupUsed = false;
    page.aiCleanupSkippedReason = error instanceof Error ? error.message : "cleanup failed";
    skippedCount += 1;
  }
}

payload.extractionMethod =
  cleanedCount > 0
    ? `${payload.extractionMethod}+bounded-ai-cleanup`
    : payload.extractionMethod;
payload.cleanupSummary = {
  cleanedCount,
  skippedCount,
  pageLimit: PAGE_LIMIT,
};

await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
