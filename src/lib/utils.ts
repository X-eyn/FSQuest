import type { ExamTypeValue, PaperReviewStatusValue, SectionBlueprint } from "@/types/domain";

export const EXAM_TYPE_LABELS: Record<ExamTypeValue, string> = {
  CT1: "CT 1",
  CT2: "CT 2",
  CT3: "CT 3",
  CT4: "CT 4",
  FINAL_TERM: "Final Term",
};

const BANGLA_DIGITS = new Map([
  ["0", "০"],
  ["1", "১"],
  ["2", "২"],
  ["3", "৩"],
  ["4", "৪"],
  ["5", "৫"],
  ["6", "৬"],
  ["7", "৭"],
  ["8", "৮"],
  ["9", "৯"],
  [".", "."],
]);

const BANGLA_SEQUENCE = [
  "ক",
  "খ",
  "গ",
  "ঘ",
  "ঙ",
  "চ",
  "ছ",
  "জ",
  "ঝ",
  "ঞ",
];

export function toBanglaDigits(value: number | string) {
  return String(value)
    .split("")
    .map((char) => BANGLA_DIGITS.get(char) ?? char)
    .join("");
}

export function banglaSequenceLabel(index: number) {
  return BANGLA_SEQUENCE[index] ?? `${index + 1}`;
}

export function formatExamType(examType: ExamTypeValue) {
  return EXAM_TYPE_LABELS[examType];
}

export function formatPaperReviewStatus(status: PaperReviewStatusValue) {
  return status === "APPROVED" ? "Approved" : "Needs review";
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getSectionMarkSummary(section: SectionBlueprint) {
  const marksPattern = section.marksPattern;
  if (marksPattern?.length) {
    const total = marksPattern.reduce((sum, item) => sum + item, 0);
    if (
      marksPattern.every((item) => item === marksPattern[0] && marksPattern[0])
    ) {
      return `${toBanglaDigits(marksPattern[0])}×${toBanglaDigits(marksPattern.length)}=${toBanglaDigits(total)}`;
    }

    return `${marksPattern.map(toBanglaDigits).join("+")}=${toBanglaDigits(total)}`;
  }

  if (section.marksPerItem) {
    const total = section.marksPerItem * section.itemCount;
    return `${toBanglaDigits(section.marksPerItem)}×${toBanglaDigits(section.itemCount)}=${toBanglaDigits(total)}`;
  }

  return "";
}

export function getSectionMarks(section: SectionBlueprint, itemIndex: number) {
  return section.marksPattern?.[itemIndex] ?? section.marksPerItem ?? 1;
}

export function formatAppDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}
