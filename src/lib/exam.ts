import { z } from "zod";

import type { ExamTypeValue, QuestionTypeValue, SectionBlueprint } from "@/types/domain";

export const CLASS_LEVELS = [
  "Nursery",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
] as const;

export const SUBJECTS = ["Bangla Literature"] as const;

export const QUESTION_TYPE_LABELS: Record<QuestionTypeValue, string> = {
  MEMORIZATION: "মুখস্থ",
  WORD_MEANING: "শব্দার্থ",
  SENTENCE_MAKING: "বাক্য গঠন",
  FILL_IN_BLANK: "শূন্যস্থান পূরণ",
  ANTONYM: "বিপরীত শব্দ",
  SHORT_ANSWER: "সংক্ষিপ্ত প্রশ্নোত্তর",
  ORAL_READING: "স্বরব পাঠ",
  MCQ: "বহুনির্বাচনি",
};

export const sectionBlueprintSchema = z.object({
  id: z.string(),
  type: z.enum([
    "MEMORIZATION",
    "WORD_MEANING",
    "SENTENCE_MAKING",
    "FILL_IN_BLANK",
    "ANTONYM",
    "SHORT_ANSWER",
    "ORAL_READING",
    "MCQ",
  ]),
  title: z.string(),
  instructions: z.string().optional(),
  itemCount: z.number().int().positive(),
  marksPerItem: z.number().positive().optional(),
  marksPattern: z.array(z.number().positive()).optional(),
});

export const examStructureSchema = z.array(sectionBlueprintSchema);

function makeCtTemplate(): SectionBlueprint[] {
  return [
    {
      id: "memorization",
      type: "MEMORIZATION",
      title: "মুখস্থ অংশ লেখ",
      instructions: "নির্বাচিত পাঠ থেকে মুখস্থ অংশ শুদ্ধভাবে লেখ।",
      itemCount: 1,
      marksPerItem: 5,
    },
    {
      id: "word-meaning",
      type: "WORD_MEANING",
      title: "শব্দার্থ লেখ",
      itemCount: 4,
      marksPerItem: 0.5,
    },
    {
      id: "sentence-making",
      type: "SENTENCE_MAKING",
      title: "বাক্য গঠন কর",
      itemCount: 2,
      marksPerItem: 1,
    },
    {
      id: "fill-blank",
      type: "FILL_IN_BLANK",
      title: "খালি ঘরের শব্দটি লেখ",
      instructions: "শুদ্ধ উত্তর লেখ।",
      itemCount: 2,
      marksPerItem: 1,
    },
    {
      id: "antonym",
      type: "ANTONYM",
      title: "বিপরীত শব্দ লেখ",
      itemCount: 2,
      marksPerItem: 0.5,
    },
    {
      id: "short-answer",
      type: "SHORT_ANSWER",
      title: "নিচের প্রশ্নগুলোর উত্তর লেখ",
      itemCount: 2,
      marksPattern: [1, 2],
    },
    {
      id: "oral-reading",
      type: "ORAL_READING",
      title: "স্বরব পাঠ",
      itemCount: 1,
      marksPerItem: 5,
    },
  ];
}

function makeFinalTemplate(): SectionBlueprint[] {
  return [
    {
      id: "mcq",
      type: "MCQ",
      title: "সঠিক উত্তরটি বেছে লেখ",
      itemCount: 10,
      marksPerItem: 1,
    },
    {
      id: "fill-blank",
      type: "FILL_IN_BLANK",
      title: "খালি স্থান পূরণ কর",
      itemCount: 10,
      marksPerItem: 1,
    },
    {
      id: "word-meaning",
      type: "WORD_MEANING",
      title: "শব্দার্থ লেখ",
      itemCount: 10,
      marksPerItem: 1,
    },
    {
      id: "antonym",
      type: "ANTONYM",
      title: "বিপরীত শব্দ লেখ",
      itemCount: 10,
      marksPerItem: 1,
    },
    {
      id: "sentence-making",
      type: "SENTENCE_MAKING",
      title: "বাক্য গঠন কর",
      itemCount: 5,
      marksPerItem: 2,
    },
    {
      id: "short-answer",
      type: "SHORT_ANSWER",
      title: "সংক্ষিপ্ত প্রশ্নের উত্তর দাও",
      itemCount: 10,
      marksPerItem: 3,
    },
    {
      id: "memorization",
      type: "MEMORIZATION",
      title: "মুখস্থ অংশ লেখ",
      itemCount: 2,
      marksPerItem: 5,
    },
    {
      id: "oral-reading",
      type: "ORAL_READING",
      title: "স্বরব পাঠ",
      itemCount: 1,
      marksPerItem: 10,
    },
  ];
}

export function getDefaultExamStructure(examType: ExamTypeValue) {
  return examType === "FINAL_TERM" ? makeFinalTemplate() : makeCtTemplate();
}

export function getDefaultDurationMinutes(examType: ExamTypeValue) {
  return examType === "FINAL_TERM" ? 180 : 40;
}

export function getDefaultTotalMarks(examType: ExamTypeValue) {
  return examType === "FINAL_TERM" ? 100 : 20;
}

export function parseExamStructure(value: string) {
  return examStructureSchema.parse(JSON.parse(value));
}
