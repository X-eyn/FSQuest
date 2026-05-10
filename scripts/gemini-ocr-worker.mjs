import fs from "node:fs/promises";

import { PDFParse } from "pdf-parse";

const GEMINI_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_GEMINI_OCR_MODEL =
  process.env.GEMINI_OCR_MODEL?.trim() || "models/gemini-3.1-flash-lite";
const OCR_PROMPT = `You are doing strict OCR transcription for one Bangla primary school textbook page.

Rules:
- Read only the text that is visibly printed on this page.
- Follow reading order from top to bottom and left to right.
- Preserve line breaks when they separate printed items or answer lines.
- Ignore illustrations and decorative artwork.
- Do not summarize.
- Do not explain.
- Do not translate.
- Do not add bullets, numbering, or markdown that are not printed.
- If a word is unclear, copy your best visible reading instead of omitting it.
- Never solve, match, fill, reorder, expand, or complete any exercise.
- If the page contains blanks, matching tasks, option banks, question prompts, or unfinished lines, transcribe them exactly as printed and keep them unfinished.
- If a line ends with a dash, colon, or blank space on the page, keep it that way unless the printed page itself shows text after it.

Return only the transcription text.`;
const EXERCISE_RETRY_PROMPT = `Redo this OCR as a strict copy of the printed page.

Extra safety rules for exercise pages:
- Do not solve the exercise.
- Do not match left-side items with right-side answers.
- Do not fill blanks.
- Do not move words from a right-side word bank into left-side answer lines.
- Keep option banks, blanks, separators, and unfinished answer lines exactly as printed.
- If the page shows a left-side item such as "মুরগি -" with no printed answer beside it, return "মুরগি -" and nothing more on that line.

Return only the visible transcription text.`;
const CLEANUP_PROMPT_TEMPLATE = `You are lightly correcting OCR text from a Bangla primary school textbook page.

Rules:
- Keep the same reading order and the same content as the OCR input.
- Preserve line breaks as much as possible.
- Fix obvious Unicode script mixups inside Bangla words when the intended character is clear.
- Fix obvious punctuation glitches when the printed mark is clear.
- Do not summarize.
- Do not explain.
- Do not translate.
- Do not add bullets, numbering, or markdown that are not already present.
- Do not invent new content.
- Do not solve, fill, reorder, or complete exercises.
- Keep blanks, matching items, and unfinished answer lines exactly as they appear in the OCR input.

OCR input:
{ocr_text}`;

const [, , pdfPath, outputPath, tmpDir] = process.argv;

if (!pdfPath || !outputPath || !tmpDir) {
  throw new Error("Gemini OCR worker missing required arguments.");
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required for Gemini OCR.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanOcrText(text) {
  return text
    .normalize("NFC")
    .replace(/\r/g, "")
    .replace(/[|Â¦]/g, "।")
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

function cleanupTextForPrompt(text) {
  return text.replace(/\uFEFF/g, "").trim().replace(/\n{3,}/g, "\n\n");
}

function extractTextFromGeminiPayload(payload) {
  return (
    payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function buildGeminiRequest(prompt, imageBase64) {
  return {
    contents: [
      {
        parts: imageBase64
          ? [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: imageBase64,
                },
              },
            ]
          : [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
    },
  };
}

async function generateGeminiText(prompt, imageBase64 = null) {
  const body = JSON.stringify(buildGeminiRequest(prompt, imageBase64));
  let response = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${DEFAULT_GEMINI_OCR_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      },
    );

    if (response.ok || !GEMINI_RETRY_STATUSES.has(response.status) || attempt === 4) {
      break;
    }

    await sleep(1200 * attempt);
  }

  if (!response || !response.ok) {
    throw new Error(`Gemini OCR failed with status ${response?.status ?? "unknown"}.`);
  }

  const payload = await response.json();
  const text = extractTextFromGeminiPayload(payload);
  if (!text) {
    throw new Error("Gemini OCR returned an empty transcription.");
  }

  return text;
}

async function cleanupTranscription(text) {
  const cleaned = await generateGeminiText(
    CLEANUP_PROMPT_TEMPLATE.replace("{ocr_text}", cleanupTextForPrompt(text)),
  );
  return cleanOcrText(cleaned);
}

function looksLikeExercisePage(text) {
  return /(অনুশীলনী|খালি জায়গায়|কোনটি সঠিক|বলি ও লিখি|প্রশ্ন|ডান পাশ|বাম পাশে|মেলাও|মিল কর|শব্দ এনে)/u.test(
    text,
  );
}

function looksLikeMatchingPage(text) {
  return /(ডান পাশ.*বাম পাশে|শব্দ এনে.*বসাই|মেলাও|মিল কর|জোড়া মিলাও)/u.test(text);
}

function getMatchingCompletionScore(text) {
  if (!looksLikeMatchingPage(text)) {
    return 0;
  }

  const lines = cleanOcrText(text).split("\n");
  const pairLines = lines.filter((line) =>
    /^[\p{Script=Bengali}\d০-৯()\s]+[-–—:]\s*[\p{Script=Bengali}][\p{Script=Bengali}\s]{0,24}$/u.test(
      line,
    ),
  );
  const unresolvedLines = lines.filter((line) =>
    /^[\p{Script=Bengali}\d০-৯()\s]+[-–—:]\s*$/u.test(line),
  );

  return unresolvedLines.length === 0 ? pairLines.length : 0;
}

function isSuspiciousSolvedMatchingPage(text) {
  return getMatchingCompletionScore(text) >= 3;
}

function detectPageType(text) {
  if (looksLikeMatchingPage(text)) {
    return "matching";
  }

  if (looksLikeExercisePage(text)) {
    return "exercise";
  }

  return "body";
}

async function transcribePage(imageBytes) {
  const imageBase64 = Buffer.from(imageBytes).toString("base64");
  const firstRaw = await generateGeminiText(OCR_PROMPT, imageBase64);
  const firstText = await cleanupTranscription(firstRaw);
  const pageType = detectPageType(firstText);
  const suspiciousCompletion =
    looksLikeExercisePage(firstText) && isSuspiciousSolvedMatchingPage(firstText);

  if (!suspiciousCompletion) {
    return {
      pageType,
      retryUsed: false,
      text: firstText,
    };
  }

  const retryRaw = await generateGeminiText(EXERCISE_RETRY_PROMPT, imageBase64);
  const retryText = await cleanupTranscription(retryRaw);
  const firstScore = getMatchingCompletionScore(firstText);
  const retryScore = getMatchingCompletionScore(retryText);

  return {
    pageType,
    retryUsed: true,
    text: retryScore <= firstScore ? retryText : firstText,
  };
}

await fs.mkdir(tmpDir, { recursive: true });
const buffer = await fs.readFile(pdfPath);
const parser = new PDFParse({ data: buffer });

try {
  const info = await parser.getInfo({ parsePageInfo: true });
  const pages = [];

  for (let pageNumber = 1; pageNumber <= info.total; pageNumber += 1) {
    const screenshot = await parser.getScreenshot({
      partial: [pageNumber],
      scale: 2,
    });
    const imageBytes = screenshot.pages[0]?.data;
    if (!imageBytes) {
      throw new Error(`Could not render PDF page ${pageNumber} for OCR.`);
    }

    const transcription = await transcribePage(imageBytes);
    pages.push({
      pageNumber,
      text: transcription.text,
      pageType: transcription.pageType,
      retryUsed: transcription.retryUsed,
    });
  }

  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        pageCount: info.total,
        pages,
        extractionMethod: `${DEFAULT_GEMINI_OCR_MODEL.replace(/^models\//, "")}+exercise-guard`,
      },
      null,
      2,
    ),
    "utf8",
  );
} finally {
  await parser.destroy();
}
