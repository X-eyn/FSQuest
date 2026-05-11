/**
 * One-shot chapter indexer.
 * Runs from the WORKTREE root:
 *   node scripts/index-chapter.mjs
 *
 * What it does:
 *   1. Reads GOOGLE_API_KEY / GEMINI_API_KEY from .env (main or worktree)
 *   2. OCRs pages 35-39 of the Class-3 Bangla PDF via Gemini
 *   3. Creates Book + Chapter records in the SQLite DB
 *   4. POSTs to localhost:3000/api/papers to generate questions + DOCX
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const WORKTREE_ROOT = path.resolve(path.dirname(__filename), "..");
// .claude/worktrees/<name> → up 3 levels → FSQuest root
const MAIN_ROOT = path.resolve(WORKTREE_ROOT, "../../..");

// ─── Load .env ────────────────────────────────────────────────────────────────
async function readDotEnv(envPath) {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    const out = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i);
      if (m) out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const envVars = {
  ...(await readDotEnv(path.join(MAIN_ROOT, ".env"))),
  ...(await readDotEnv(path.join(WORKTREE_ROOT, ".env"))),
};

const GEMINI_API_KEY = envVars.GEMINI_API_KEY || envVars.GOOGLE_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY must be set in .env");
console.log("✓ API key loaded");

// ─── Config ───────────────────────────────────────────────────────────────────
const PDF_PATH = path.join(MAIN_ROOT, "Class-3, Bangla combine _compressed (1).pdf");
const START_PAGE = 35;
const END_PAGE   = 39;
const CHAPTER_TITLE = "বেঙের শাজা";    // "Beng er Shaja" – the chapter name
const BOOK_TITLE    = "Class 3 Bangla Combine";
const CLASS_LEVEL   = "Three";
const SUBJECT       = "Bangla Literature";
const EXAM_TYPE     = "CT1";
const DEV_SERVER    = "http://localhost:3000";
// Try models in order until one works
const GEMINI_MODELS = [
  envVars.GEMINI_OCR_MODEL,
  "models/gemini-2.5-flash",
  "models/gemini-2.5-flash-lite",
  "models/gemini-3.1-flash-lite",
  "models/gemini-2.0-flash",
].filter(Boolean);
let GEMINI_MODEL = GEMINI_MODELS[0];

const STORAGE_ROOT   = path.join(WORKTREE_ROOT, "storage");
const UPLOADS_DIR    = path.join(STORAGE_ROOT, "uploads");
const RAW_DIR        = path.join(STORAGE_ROOT, "raw");
const GENERATED_DIR  = path.join(STORAGE_ROOT, "generated");
const TMP_DIR        = path.join(STORAGE_ROOT, "tmp");

// ─── Gemini helpers ───────────────────────────────────────────────────────────
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

const OCR_PROMPT = `You are doing strict OCR transcription for one Bangla primary school textbook page.
Rules:
- Read only visible printed text, top-to-bottom, left-to-right.
- Preserve line breaks when they separate printed items or answer lines.
- Ignore illustrations and decorative artwork.
- Do not summarize, explain, translate, or add markdown.
- Transcribe blanks, option banks, and unfinished lines exactly as printed.
Return only the transcription text.`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanOcr(text) {
  return text.normalize("NFC")
    .replace(/\r/g, "")
    .replace(/[|Â¦]/g, "।")
    .split("\n")
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 0)
    .join("\n");
}

function extractText(payload) {
  return payload?.candidates?.[0]?.content?.parts
    ?.map(p => p?.text ?? "").join("").trim() ?? "";
}

async function geminiWithModel(model, prompt, imageBase64 = null) {
  const parts = imageBase64
    ? [{ text: prompt }, { inlineData: { mimeType: "image/png", data: imageBase64 } }]
    : [{ text: prompt }];

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature: 0.1 },
  });

  let res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body }
    );
    if (res.ok) break;
    if (!RETRY_STATUSES.has(res.status) || attempt === 5) break;

    // Respect retry-after from error body
    let retryAfterMs = 1500 * attempt;
    try {
      const errBody = await res.clone().json();
      const retryDetails = errBody?.error?.details?.find(d => d["@type"]?.includes("RetryInfo"));
      const retryDelay = retryDetails?.retryDelay;
      if (retryDelay) {
        const secs = parseInt(retryDelay.replace("s", ""), 10);
        if (!isNaN(secs)) retryAfterMs = (secs + 2) * 1000;
      }
    } catch {}
    console.log(`  ↺ Retry ${attempt} for ${model} in ${Math.round(retryAfterMs / 1000)}s …`);
    await sleep(retryAfterMs);
  }

  return res;
}

async function gemini(prompt, imageBase64 = null) {
  // Try each model in order; fall back if quota exhausted (429 w/ daily limit)
  for (let mi = 0; mi < GEMINI_MODELS.length; mi++) {
    const model = GEMINI_MODELS[mi];
    const res = await geminiWithModel(model, prompt, imageBase64);

    if (res.ok) {
      if (model !== GEMINI_MODEL) {
        GEMINI_MODEL = model;
        console.log(`  → switched to model: ${model}`);
      }
      const text = extractText(await res.json());
      if (!text) throw new Error("Gemini returned empty response");
      return text;
    }

    // Check if this is a quota/daily limit – if so, try next model
    let isQuotaError = false;
    try {
      const errBody = await res.clone().json();
      const msg = errBody?.error?.message ?? "";
      isQuotaError = res.status === 429 && (
        msg.includes("free_tier") || msg.includes("quota") || msg.includes("Per Day")
      );
    } catch {}

    if (isQuotaError && mi < GEMINI_MODELS.length - 1) {
      console.log(`  ⚠ Quota hit on ${model}, trying ${GEMINI_MODELS[mi + 1]} …`);
      continue;
    }

    const err = await res.text().catch(() => res.status.toString());
    throw new Error(`Gemini request failed (${res.status}): ${err}`);
  }
  throw new Error("All Gemini models exhausted their quota");
}

async function ocrPage(imageBytes) {
  const b64 = Buffer.from(imageBytes).toString("base64");
  const raw = await gemini(OCR_PROMPT, b64);
  // Light cleanup via second Gemini call
  const cleaned = await gemini(
    `Lightly correct OCR text from a Bangla textbook page. Fix Unicode/punctuation glitches only. Do NOT solve exercises or fill blanks. Return corrected text only.\n\nOCR input:\n${raw}`
  );
  return cleanOcr(cleaned);
}

// ─── OCR pages 35-39 ─────────────────────────────────────────────────────────
console.log(`\n📄 Loading PDF: ${path.basename(PDF_PATH)}`);
await fs.access(PDF_PATH).catch(() => { throw new Error(`PDF not found: ${PDF_PATH}`); });

const { PDFParse } = await import("pdf-parse");
const pdfBuffer = await fs.readFile(PDF_PATH);
const parser = new PDFParse({ data: pdfBuffer });

let totalPages = 0;
try {
  const info = await parser.getInfo({ parsePageInfo: true });
  totalPages = info.total;
  console.log(`   ${totalPages} pages total; OCR-ing pages ${START_PAGE}–${END_PAGE}`);
} catch (e) {
  throw new Error(`Could not read PDF info: ${e.message}`);
}

await fs.mkdir(TMP_DIR, { recursive: true });

const pageTexts = [];
for (let pageNum = START_PAGE; pageNum <= END_PAGE; pageNum++) {
  process.stdout.write(`   Page ${pageNum}/${END_PAGE} … `);
  const screenshot = await parser.getScreenshot({ partial: [pageNum], scale: 2 });
  const imageBytes = screenshot.pages[0]?.data;
  if (!imageBytes) throw new Error(`Could not render page ${pageNum}`);
  const text = await ocrPage(imageBytes);
  pageTexts.push({ pageNumber: pageNum, text });
  console.log(`✓ (${text.split("\n").length} lines)`);
}

await parser.destroy().catch(() => {});

const chapterText = pageTexts.map(p => p.text).join("\n\n---\n\n");
const excerpt = pageTexts[0]?.text.split("\n").slice(0, 4).join(" ").substring(0, 300) || "";
console.log(`\n✓ OCR complete – ${chapterText.length} chars`);

// ─── Create storage dirs and copy PDF ────────────────────────────────────────
await Promise.all([
  fs.mkdir(UPLOADS_DIR, { recursive: true }),
  fs.mkdir(RAW_DIR, { recursive: true }),
  fs.mkdir(GENERATED_DIR, { recursive: true }),
]);

const bookId = randomUUID();
const pdfDest = path.join(UPLOADS_DIR, `${bookId}.pdf`);
await fs.copyFile(PDF_PATH, pdfDest);
const pdfStoragePath = `uploads/${bookId}.pdf`;

// Write raw pages JSON
const rawData = { pageCount: totalPages, pages: pageTexts, extractionMethod: GEMINI_MODEL };
const rawJsonPath = path.join(RAW_DIR, `${bookId}.json`);
await fs.writeFile(rawJsonPath, JSON.stringify(rawData, null, 2), "utf8");
const rawTextPath = `raw/${bookId}.json`;

console.log(`\n💾 Creating DB records …`);

// ─── Prisma setup ─────────────────────────────────────────────────────────────
const { PrismaClient } = await import("@prisma/client");
const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");

const dbUrl = envVars.DATABASE_URL || `file:${path.join(WORKTREE_ROOT, "prisma", "dev.db")}`;
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

// ─── Write Book + Chapter ─────────────────────────────────────────────────────
const chapterId = randomUUID();

await prisma.$transaction([
  prisma.book.create({
    data: {
      id: bookId,
      title: BOOK_TITLE,
      classLevel: CLASS_LEVEL,
      subject: SUBJECT,
      pdfFileName: path.basename(PDF_PATH),
      pdfStoragePath,
      rawTextPath,
      pageCount: totalPages,
      extractionMethod: GEMINI_MODEL,
      importStatus: "INDEXED",
      notes: `Chapter '${CHAPTER_TITLE}' indexed from pages ${START_PAGE}–${END_PAGE}.`,
      indexedAt: new Date(),
    },
  }),
  prisma.chapter.create({
    data: {
      id: chapterId,
      bookId,
      title: CHAPTER_TITLE,
      sortOrder: 1,
      startPage: START_PAGE,
      endPage: END_PAGE,
      excerpt,
      text: chapterText,
    },
  }),
]);

console.log(`✓ Book  id: ${bookId}`);
console.log(`✓ Chapter id: ${chapterId}  ("${CHAPTER_TITLE}", pg ${START_PAGE}–${END_PAGE})`);

// ─── Ensure seed data (settings + templates) exists ──────────────────────────
const settingsExist = await prisma.appSetting.findUnique({ where: { id: "default" } });
if (!settingsExist) {
  console.log("  Seeding app settings …");
  const { CLASS_LEVELS, getDefaultDurationMinutes, getDefaultExamStructure, getDefaultTotalMarks } =
    await import("../src/lib/exam.js").catch(() => null) ?? {};
  // Minimal seed if imports aren't available
  await prisma.appSetting.create({
    data: {
      id: "default",
      schoolName: "Foundation School & College",
      schoolTagline: null,
      defaultSubject: "Bangla Literature",
      defaultExamMinutes: 40,
    },
  });
}

const templateExists = await prisma.examTemplate.findUnique({
  where: { classLevel_examType: { classLevel: CLASS_LEVEL, examType: EXAM_TYPE } },
});
if (!templateExists) {
  throw new Error(
    `No ExamTemplate found for class="${CLASS_LEVEL}" examType="${EXAM_TYPE}". ` +
    `Open the app at ${DEV_SERVER} once to seed templates, then re-run this script.`
  );
}

console.log(`✓ Template found: ${templateExists.displayName} (${templateExists.totalMarks} marks)`);

// ─── Generate paper via running dev server ────────────────────────────────────
console.log(`\n🤖 Generating questions via ${DEV_SERVER}/api/papers …`);

const paperRes = await fetch(`${DEV_SERVER}/api/papers`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    bookId,
    chapterIds: [chapterId],
    examType: EXAM_TYPE,
    allowReuse: false,
  }),
});

const paperJson = await paperRes.json();

if (!paperRes.ok) {
  throw new Error(`Paper generation failed (${paperRes.status}): ${JSON.stringify(paperJson)}`);
}

console.log(`\n✅ Done!`);
console.log(`   Paper ID   : ${paperJson.paperId}`);
console.log(`   Status     : ${paperJson.reviewStatus}`);
if (paperJson.qualityReport?.issues?.length) {
  console.log(`   QA issues  :`);
  for (const iss of paperJson.qualityReport.issues) {
    console.log(`     [${iss.severity}] ${iss.message}`);
  }
}
console.log(`\n   Open the app and click "Review" on the paper to view and export the DOCX.`);

await prisma.$disconnect();
