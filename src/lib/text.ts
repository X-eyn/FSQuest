import { banglaSequenceLabel } from "@/lib/utils";
import { isUsableBanglaWord } from "@/lib/quality";

export type OcrPage = {
  pageNumber: number;
  text: string;
};

export type ChapterDraft = {
  title: string;
  sortOrder: number;
  startPage: number;
  endPage: number;
  excerpt: string;
  text: string;
};

const STOP_WORDS = new Set([
  "এবং",
  "করে",
  "করি",
  "করা",
  "হয়",
  "হবে",
  "তাকে",
  "তারা",
  "আমরা",
  "আমি",
  "তুমি",
  "সে",
  "এই",
  "ওই",
  "একটি",
  "একটা",
  "খুব",
  "থাকে",
  "আছে",
  "ছিল",
  "নিয়ে",
  "যায়",
  "যাও",
  "লেখ",
  "পড়ে",
  "পাঠ",
  "অধ্যায়",
  "উত্তর",
  "নিচের",
  "শুদ্ধ",
  "শব্দ",
  "কর",
  "কোন",
  "কোনো",
  "সাথে",
  "বিভিন্ন",
  "প্রত্যেক",
  "নিজেদের",
]);

export const ANTONYM_PAIRS = [
  ["শীতল", "উষ্ণ"],
  ["পরিষ্কার", "ময়লা"],
  ["সুখ", "দুঃখ"],
  ["ভালো", "মন্দ"],
  ["বড়", "ছোট"],
  ["দিন", "রাত"],
  ["সত্য", "মিথ্যা"],
  ["আগে", "পরে"],
  ["নতুন", "পুরোনো"],
  ["সহজ", "কঠিন"],
];

export function cleanOcrText(text: string) {
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

export function extractSentences(text: string) {
  return text
    .replace(/\n+/g, " ")
    .split(/[।?!]/u)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 10);
}

export function extractBanglaWords(text: string) {
  const words = text.match(/[\u0980-\u09FF]{2,}/gu) ?? [];
  return words
    .map((word) => word.replace(/\s+/g, " ").trim())
    .filter((word) => !STOP_WORDS.has(word) && isUsableBanglaWord(word));
}

export function pickDistinctWords(text: string, count: number) {
  const frequency = new Map<string, number>();
  for (const word of extractBanglaWords(text)) {
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  return [...frequency.entries()]
    .sort((a, b) => {
      if (a[1] === b[1]) {
        return b[0].length - a[0].length || a[0].localeCompare(b[0], "bn");
      }
      return b[1] - a[1];
    })
    .map(([word]) => word)
    .slice(0, count);
}

export function buildExcerpt(text: string) {
  const sentence = extractSentences(text)[0] ?? text.slice(0, 160);
  return sentence.slice(0, 180);
}

function isLikelyTitleLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.length > 70) {
    return false;
  }

  if (/^[\d০-৯\s.,:;=+\-_/()%]+$/u.test(trimmed)) {
    return false;
  }

  return /[\u0980-\u09FF]/u.test(trimmed);
}

function detectHeading(lines: string[]) {
  const candidates = lines.slice(0, 8);

  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index]
      .replace(/[।:]+$/u, "")
      .replace(/\s+/g, " ")
      .trim();

    if (/^(পাঠ|অধ্যায়)\s*[০-৯0-9]+/u.test(current)) {
      const titleLine = candidates
        .slice(index + 1)
        .find((line) => isLikelyTitleLine(line));
      return titleLine ? `${current} — ${titleLine}` : current;
    }

    if (/^(কবিতা|গল্প|ছড়া|ছড়া)/u.test(current) && isLikelyTitleLine(current)) {
      return current;
    }
  }

  return null;
}

export function segmentPagesIntoChapters(pages: OcrPage[]) {
  const chapterStarts = pages
    .map((page) => {
      const title = detectHeading(page.text.split("\n"));
      return title
        ? {
            title,
            pageNumber: page.pageNumber,
          }
        : null;
    })
    .filter((entry): entry is { title: string; pageNumber: number } => Boolean(entry));

  if (chapterStarts.length === 0) {
    const chunkSize = 8;
    const chapters: ChapterDraft[] = [];

    for (let start = 0; start < pages.length; start += chunkSize) {
      const slice = pages.slice(start, start + chunkSize);
      const text = slice.map((page) => page.text).join("\n\n");
      const sortOrder = chapters.length + 1;
      chapters.push({
        title: `অংশ ${banglaSequenceLabel(chapters.length)}`,
        sortOrder,
        startPage: slice[0]?.pageNumber ?? start + 1,
        endPage: slice.at(-1)?.pageNumber ?? start + chunkSize,
        excerpt: buildExcerpt(text),
        text,
      });
    }

    return {
      chapters,
      usedFallback: true,
    };
  }

  const chapters: ChapterDraft[] = [];

  for (let index = 0; index < chapterStarts.length; index += 1) {
    const start = chapterStarts[index];
    const end = chapterStarts[index + 1];
    const slice = pages.filter(
      (page) =>
        page.pageNumber >= start.pageNumber &&
        page.pageNumber < (end?.pageNumber ?? Number.POSITIVE_INFINITY),
    );
    const text = slice.map((page) => page.text).join("\n\n");

    chapters.push({
      title: start.title,
      sortOrder: index + 1,
      startPage: start.pageNumber,
      endPage: slice.at(-1)?.pageNumber ?? start.pageNumber,
      excerpt: buildExcerpt(text),
      text,
    });
  }

  return {
    chapters,
    usedFallback: false,
  };
}
