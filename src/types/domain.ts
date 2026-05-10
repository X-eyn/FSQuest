export type ImportStatusValue =
  | "UPLOADED"
  | "INDEXING"
  | "INDEXED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type ExamTypeValue = "CT1" | "CT2" | "CT3" | "CT4" | "FINAL_TERM";

export type PaperReviewStatusValue = "DRAFT" | "APPROVED";

export type QuestionTypeValue =
  | "MEMORIZATION"
  | "WORD_MEANING"
  | "SENTENCE_MAKING"
  | "FILL_IN_BLANK"
  | "ANTONYM"
  | "SHORT_ANSWER"
  | "ORAL_READING"
  | "MCQ"
  | "MATCHING";

export type SectionBlueprint = {
  id: string;
  type: QuestionTypeValue;
  title: string;
  instructions?: string;
  itemCount: number;
  marksPerItem?: number;
  marksPattern?: number[];
};

export type AppSettingData = {
  schoolName: string;
  schoolTagline: string | null;
  defaultSubject: string;
  defaultExamMinutes: number;
};

export type ChapterData = {
  id: string;
  title: string;
  sortOrder: number;
  startPage: number | null;
  endPage: number | null;
  excerpt: string | null;
  text: string;
  quality: QualitySummary;
  updatedAt: string;
};

export type BookData = {
  id: string;
  title: string;
  classLevel: string;
  subject: string;
  pageCount: number;
  importStatus: ImportStatusValue;
  extractionMethod: string | null;
  notes: string | null;
  indexedAt: string | null;
  createdAt: string;
  chapters: ChapterData[];
};

export type ExamTemplateData = {
  id: string;
  classLevel: string;
  examType: ExamTypeValue;
  displayName: string;
  totalMarks: number;
  durationMinutes: number;
  instructions: string | null;
  structure: SectionBlueprint[];
};

export type PaperQuestionData = {
  id: string;
  sectionKey: string;
  sectionTitle: string;
  itemOrder: number;
  subLabel: string | null;
  questionType: QuestionTypeValue;
  prompt: string;
  answerText: string | null;
  marks: number;
  sourceExcerpt: string | null;
};

export type QualityIssue = {
  severity: "error" | "warning";
  area: "chapter" | "question" | "paper" | "ocr" | "template";
  message: string;
  itemId?: string | null;
  sectionKey?: string | null;
};

export type QualitySummary = {
  status: "blocked" | "needs_review" | "ready";
  score: number;
  issues: QualityIssue[];
};

export type PaperQualityReport = QualitySummary & {
  generatedAt: string;
};

export type GeneratedPaperData = {
  id: string;
  bookId: string;
  classLevel: string;
  subject: string;
  examType: ExamTypeValue;
  title: string;
  totalMarks: number;
  includedChapterIds: string[];
  allowReuse: boolean;
  docxPath: string;
  reviewStatus: PaperReviewStatusValue;
  approvedAt: string | null;
  qualityReport: PaperQualityReport | null;
  createdAt: string;
  templateId: string | null;
  questions: PaperQuestionData[];
};

export type DashboardData = {
  settings: AppSettingData;
  books: BookData[];
  templates: ExamTemplateData[];
  papers: GeneratedPaperData[];
};
