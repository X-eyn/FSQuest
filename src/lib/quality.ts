import { getSectionMarks } from "@/lib/utils";
import type {
  PaperQualityReport,
  QualityIssue,
  QualitySummary,
  QuestionTypeValue,
  SectionBlueprint,
} from "@/types/domain";

export type QualityQuestion = {
  id?: string;
  sectionKey: string;
  itemOrder: number;
  questionType: QuestionTypeValue;
  prompt: string;
  answerText?: string | null;
  marks: number;
  sourceExcerpt?: string | null;
};

export type ChapterQualityInput = {
  title: string;
  text: string;
  excerpt?: string | null;
};

const BANGLA_LETTER_PATTERN = /[অ-ঔক-হড়ঢ়য়ৎ]/u;
const LATIN_PATTERN = /[A-Za-z]/g;
const BANGLA_PATTERN = /[\u0980-\u09FF]/g;
const LONG_DIGIT_RUN_PATTERN = /[০-৯0-9]{6,}/u;
const MOJIBAKE_PATTERN = /[�ÃÂ]|(?:\b[A-Z]{2,}\b)|(?:[A-Za-z]{2,}\s+[A-Za-z]{2,})/u;

export function hasBanglaLetter(value: string) {
  return BANGLA_LETTER_PATTERN.test(value);
}

export function normalizeQualityKey(value: string) {
  return value
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isUsableBanglaWord(value: string) {
  const cleaned = value.normalize("NFC").replace(/[।,;:!?'"“”‘’()[\]{}]/g, "").trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 28) {
    return false;
  }

  if (!hasBanglaLetter(cleaned) || /[A-Za-z0-9০-৯]/u.test(cleaned)) {
    return false;
  }

  if (/মানে/u.test(cleaned)) {
    return false;
  }

  if (MOJIBAKE_PATTERN.test(cleaned) || /[_=+*/\\]/u.test(cleaned)) {
    return false;
  }

  return true;
}

function getBanglaCount(value: string) {
  return (value.match(BANGLA_PATTERN) ?? []).length;
}

function getLatinCount(value: string) {
  return (value.match(LATIN_PATTERN) ?? []).length;
}

function hasHighLatinNoise(value: string) {
  const banglaCount = getBanglaCount(value);
  const latinCount = getLatinCount(value);
  return latinCount > 0 && latinCount > Math.max(2, Math.floor(banglaCount / 5));
}

function pushIssue(
  issues: QualityIssue[],
  issue: QualityIssue,
) {
  issues.push(issue);
}

export function assessChapterQuality(chapter: ChapterQualityInput): QualitySummary {
  const issues: QualityIssue[] = [];
  const text = `${chapter.title}\n${chapter.excerpt ?? ""}\n${chapter.text}`;
  const banglaCount = getBanglaCount(text);

  if (!hasBanglaLetter(chapter.title)) {
    pushIssue(issues, {
      severity: "error",
      area: "chapter",
      message: "Chapter title has no readable Bangla text.",
    });
  }

  if (banglaCount < 80) {
    pushIssue(issues, {
      severity: "warning",
      area: "chapter",
      message: "Chapter text is very short; generated questions may be thin.",
    });
  }

  if (hasHighLatinNoise(text) || MOJIBAKE_PATTERN.test(text)) {
    pushIssue(issues, {
      severity: "warning",
      area: "ocr",
      message: "OCR text still has Latin/noise artifacts. Review this chapter before using it for exams.",
    });
  }

  if (LONG_DIGIT_RUN_PATTERN.test(text)) {
    pushIssue(issues, {
      severity: "warning",
      area: "ocr",
      message: "OCR text contains long digit runs that may leak into questions.",
    });
  }

  return summarizeIssues(issues);
}

function validateQuestionShape(question: QualityQuestion, issues: QualityIssue[]) {
  const prompt = question.prompt.trim();
  const itemId = question.id ?? `${question.sectionKey}-${question.itemOrder}`;

  if (!prompt) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Question prompt is empty.",
    });
    return;
  }

  if (!hasBanglaLetter(prompt)) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Question prompt has no readable Bangla text.",
    });
  }

  if (hasHighLatinNoise(prompt) || MOJIBAKE_PATTERN.test(prompt)) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Question prompt contains OCR noise or Latin artifacts.",
    });
  }

  if (/^(শব্দ\s*\d+|উপযুক্ত শব্দ লিখে শূন্যস্থান পূরণ কর)/u.test(prompt)) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Question is a generic fallback, not a real teacher-ready item.",
    });
  }

  if (/নিচের তথ্যের ভিত্তিতে/u.test(prompt)) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Short-answer prompt exposes generator scaffolding.",
    });
  }

  if (LONG_DIGIT_RUN_PATTERN.test(prompt)) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Question prompt contains suspicious long digit runs.",
    });
  }

  if (
    ["WORD_MEANING", "SENTENCE_MAKING", "ANTONYM"].includes(question.questionType) &&
    (!isUsableBanglaWord(prompt) || prompt.split(/\s+/).length > 3)
  ) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Word-based question does not contain a clean Bangla word.",
    });
  }

  if (question.questionType === "FILL_IN_BLANK" && !/\.{5,}|…/u.test(prompt)) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Fill-in-the-blank question is missing the blank.",
    });
  }

  if (
    question.questionType === "FILL_IN_BLANK" &&
    (prompt.length < 25 || !question.answerText?.trim())
  ) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Fill-in-the-blank item is too weak or missing its teacher answer.",
    });
  }

  if (
    ["WORD_MEANING", "ANTONYM", "SHORT_ANSWER", "MATCHING"].includes(question.questionType) &&
    !question.answerText?.trim()
  ) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Question is missing the teacher answer.",
    });
  }

  if (
    question.answerText &&
    (hasHighLatinNoise(question.answerText) ||
      MOJIBAKE_PATTERN.test(question.answerText) ||
      LONG_DIGIT_RUN_PATTERN.test(question.answerText))
  ) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Teacher answer contains OCR noise or suspicious artifacts.",
    });
  }

  if (question.questionType === "SHORT_ANSWER" && question.answerText && question.answerText.length < 12) {
    pushIssue(issues, {
      severity: "error",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Short-answer teacher answer is too weak.",
    });
  }

  if (question.questionType === "SHORT_ANSWER" && !/[?？]$/u.test(prompt)) {
    pushIssue(issues, {
      severity: "warning",
      area: "question",
      itemId,
      sectionKey: question.sectionKey,
      message: "Short-answer prompt should read like a direct question.",
    });
  }
}

export function buildPaperQualityReport(params: {
  questions: QualityQuestion[];
  structure: SectionBlueprint[];
  totalMarks: number;
  chapterSummaries?: QualitySummary[];
}): PaperQualityReport {
  const issues: QualityIssue[] = [];
  const seenPrompts = new Set<string>();

  for (const chapterSummary of params.chapterSummaries ?? []) {
    for (const issue of chapterSummary.issues) {
      if (issue.severity === "error") {
        pushIssue(issues, issue);
      }
    }
  }

  for (const section of params.structure) {
    const sectionQuestions = params.questions.filter(
      (question) => question.sectionKey === section.id,
    );

    if (sectionQuestions.length !== section.itemCount) {
      pushIssue(issues, {
        severity: "error",
        area: "paper",
        sectionKey: section.id,
        message: `${section.title} needs exactly ${section.itemCount} item(s), but has ${sectionQuestions.length}.`,
      });
    }

    sectionQuestions.forEach((question, index) => {
      const expectedMarks = getSectionMarks(section, index);
      if (question.marks !== expectedMarks) {
        pushIssue(issues, {
          severity: "warning",
          area: "paper",
          itemId: question.id ?? `${question.sectionKey}-${question.itemOrder}`,
          sectionKey: question.sectionKey,
          message: "Question marks differ from the exam blueprint.",
        });
      }
    });
  }

  for (const question of params.questions) {
    validateQuestionShape(question, issues);
    const key = normalizeQualityKey(question.prompt);
    if (seenPrompts.has(key)) {
      pushIssue(issues, {
        severity: "error",
        area: "paper",
        itemId: question.id ?? `${question.sectionKey}-${question.itemOrder}`,
        sectionKey: question.sectionKey,
        message: "Duplicate question prompt in this paper.",
      });
    }
    seenPrompts.add(key);
  }

  const totalMarks = params.questions.reduce((sum, question) => sum + question.marks, 0);
  if (Math.abs(totalMarks - params.totalMarks) > 0.001) {
    pushIssue(issues, {
      severity: "error",
      area: "paper",
      message: `Question marks add up to ${totalMarks}, not ${params.totalMarks}.`,
    });
  }

  return {
    ...summarizeIssues(issues),
    generatedAt: new Date().toISOString(),
  };
}

export function summarizeIssues(issues: QualityIssue[]): QualitySummary {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const score = Math.max(0, 100 - errorCount * 25 - warningCount * 8);

  return {
    status: errorCount > 0 ? "blocked" : warningCount > 0 ? "needs_review" : "ready",
    score,
    issues,
  };
}

export function getApprovalBlocker(report: QualitySummary) {
  const firstError = report.issues.find((issue) => issue.severity === "error");
  return firstError?.message ?? null;
}
