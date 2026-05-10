"use client";

import type { DragEvent } from "react";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Download,
  FileText,
  GripVertical,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Save,
  ScanText,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import { PaperStatusPill, StatusPill } from "@/components/status-pill";
import { CLASS_LEVELS } from "@/lib/exam";
import { formatAppDate, formatExamType, getSectionMarkSummary, toBanglaDigits } from "@/lib/utils";
import type {
  DashboardData,
  ExamTypeValue,
  GeneratedPaperData,
  PaperQualityReport,
  QuestionTypeValue,
  SectionBlueprint,
} from "@/types/domain";

const EXAM_TYPES: ExamTypeValue[] = ["CT1", "CT2", "CT3", "CT4", "FINAL_TERM"];
const PALETTE_TRANSFER_TYPE = "application/x-fsquest-question-block";
const SECTION_TRANSFER_TYPE = "application/x-fsquest-builder-section";

type QuestionBlockDefinition = {
  type: QuestionTypeValue;
  label: string;
  subtitle: string;
  explanation: string;
  defaultTitle: string;
  defaultInstructions?: string;
  defaultItemCount: number;
  defaultMarksPerItem: number;
};

const QUESTION_BLOCKS: QuestionBlockDefinition[] = [
  {
    type: "WORD_MEANING",
    label: "শব্দার্থ",
    subtitle: "Word meaning",
    explanation: "পাঠের শব্দ দিয়ে তার সহজ অর্থ লিখানো। যেমন: গুজব - মিথ্যা তথ্য।",
    defaultTitle: "শব্দার্থ লেখ",
    defaultItemCount: 4,
    defaultMarksPerItem: 0.5,
  },
  {
    type: "SENTENCE_MAKING",
    label: "বাক্য গঠন",
    subtitle: "Make sentence",
    explanation: "একটি শব্দ দিয়ে ছাত্র/ছাত্রী নিজের বাক্য লিখবে।",
    defaultTitle: "বাক্য গঠন কর",
    defaultItemCount: 2,
    defaultMarksPerItem: 1,
  },
  {
    type: "FILL_IN_BLANK",
    label: "শূন্যস্থান পূরণ",
    subtitle: "Fill in the blank",
    explanation: "একটি বাক্যের গুরুত্বপূর্ণ শব্দ ফাঁকা রেখে উত্তর লিখানো।",
    defaultTitle: "খালি ঘরের শব্দটি লেখ",
    defaultInstructions: "শুদ্ধ উত্তর লেখ।",
    defaultItemCount: 2,
    defaultMarksPerItem: 1,
  },
  {
    type: "SHORT_ANSWER",
    label: "প্রশ্নোত্তর",
    subtitle: "Short answer",
    explanation: "পাঠ থেকে সরাসরি ছোট প্রশ্ন, সঙ্গে শিক্ষক উত্তর।",
    defaultTitle: "নিচের প্রশ্নগুলোর উত্তর লেখ",
    defaultItemCount: 2,
    defaultMarksPerItem: 1,
  },
  {
    type: "MCQ",
    label: "সঠিক উত্তর",
    subtitle: "MCQ",
    explanation: "চারটি অপশন থেকে সঠিক উত্তর বাছাই।",
    defaultTitle: "সঠিক উত্তরটি বেছে লেখ",
    defaultItemCount: 4,
    defaultMarksPerItem: 1,
  },
  {
    type: "MATCHING",
    label: "মিল করো",
    subtitle: "Matching",
    explanation: "বাম পাশের শব্দ/ধ্বনির সঙ্গে ডান পাশের সঠিক মিল বসানো।",
    defaultTitle: "ডান পাশ থেকে শব্দ এনে বাম পাশে বসাই",
    defaultItemCount: 4,
    defaultMarksPerItem: 0.5,
  },
  {
    type: "ANTONYM",
    label: "বিপরীত শব্দ",
    subtitle: "Opposite word",
    explanation: "একটি শব্দের বিপরীত অর্থের শব্দ লিখানো।",
    defaultTitle: "বিপরীত শব্দ লেখ",
    defaultItemCount: 2,
    defaultMarksPerItem: 0.5,
  },
  {
    type: "MEMORIZATION",
    label: "মুখস্থ অংশ",
    subtitle: "Memorization",
    explanation: "নির্দিষ্ট পাঠ/অংশ থেকে মুখস্থ লেখা।",
    defaultTitle: "মুখস্থ অংশ লেখ",
    defaultInstructions: "নির্বাচিত পাঠ থেকে মুখস্থ অংশ শুদ্ধভাবে লেখ।",
    defaultItemCount: 1,
    defaultMarksPerItem: 5,
  },
  {
    type: "ORAL_READING",
    label: "স্বরব পাঠ",
    subtitle: "Oral reading",
    explanation: "শিক্ষক শুনে পাঠ/উচ্চারণের নম্বর দেবেন।",
    defaultTitle: "স্বরব পাঠ",
    defaultItemCount: 1,
    defaultMarksPerItem: 5,
  },
];

function getPreferredBookId(books: DashboardData["books"]) {
  return books.find((book) => book.importStatus === "INDEXED")?.id ?? books[0]?.id ?? "";
}

function getQuestionBlock(type: QuestionTypeValue) {
  return QUESTION_BLOCKS.find((block) => block.type === type) ?? QUESTION_BLOCKS[0];
}

function makeSectionId(type: QuestionTypeValue, index: number) {
  return `${type.toLowerCase().replaceAll("_", "-")}-${Date.now().toString(36)}-${index}`;
}

function createSectionFromBlock(
  block: QuestionBlockDefinition,
  index: number,
): SectionBlueprint {
  return {
    id: makeSectionId(block.type, index),
    type: block.type,
    title: block.defaultTitle,
    instructions: block.defaultInstructions,
    itemCount: block.defaultItemCount,
    marksPerItem: block.defaultMarksPerItem,
  };
}

function getSectionTotal(section: SectionBlueprint) {
  if (section.marksPattern?.length) {
    return section.marksPattern.reduce((sum, mark) => sum + mark, 0);
  }

  return (section.marksPerItem ?? 0) * section.itemCount;
}

function getStructureTotal(structure: SectionBlueprint[]) {
  return structure.reduce((sum, section) => sum + getSectionTotal(section), 0);
}

function reorderSections(
  structure: SectionBlueprint[],
  fromIndex: number,
  toIndex: number,
) {
  const next = [...structure];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) {
    return structure;
  }

  next.splice(toIndex, 0, moved);
  return next;
}

type TemplateDraft = {
  totalMarks: number;
  durationMinutes: number;
  instructions: string;
  structure: SectionBlueprint[];
};

export function DashboardClient({
  initialData,
}: {
  initialData: DashboardData;
}) {
  const router = useRouter();
  const [selectedBookId, setSelectedBookId] = useState(
    getPreferredBookId(initialData.books),
  );
  const [selectedExamType, setSelectedExamType] = useState<ExamTypeValue>("CT1");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [allowReuse, setAllowReuse] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [selectedReviewPaperId, setSelectedReviewPaperId] = useState(
    initialData.papers.find((paper) => paper.reviewStatus === "DRAFT")?.id ??
      initialData.papers[0]?.id ??
      "",
  );
  const [isPending, startTransition] = useTransition();
  const [chapterDrafts, setChapterDrafts] = useState<
    Record<string, { title: string; text: string }>
  >({});
  const [paperDrafts, setPaperDrafts] = useState<
    Record<string, { prompt: string; answerText: string }>
  >({});
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplateDraft>>({});
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const deferredBooks = useDeferredValue(initialData.books);
  const resolvedSelectedBookId = deferredBooks.some(
    (book) => book.id === selectedBookId,
  )
    ? selectedBookId
    : getPreferredBookId(deferredBooks);

  const activeBook = useMemo(
    () =>
      deferredBooks.find((book) => book.id === resolvedSelectedBookId) ??
      deferredBooks.find((book) => book.importStatus === "INDEXED") ??
      deferredBooks[0],
    [deferredBooks, resolvedSelectedBookId],
  );
  const focusedSingleChapterMode =
    deferredBooks.length === 1 &&
    activeBook?.importStatus === "INDEXED" &&
    activeBook.chapters.length === 1;

  const matchingTemplate = useMemo(
    () =>
      initialData.templates.find(
        (template) =>
          template.classLevel === (activeBook?.classLevel ?? "Three") &&
          template.examType === selectedExamType,
      ),
    [activeBook?.classLevel, initialData.templates, selectedExamType],
  );

  const effectiveSelectedChapterIds = useMemo(() => {
    if (!activeBook) {
      return [];
    }

    const validIds = new Set(activeBook.chapters.map((chapter) => chapter.id));
    const filtered = selectedChapterIds.filter((id) => validIds.has(id));
    return filtered.length > 0
      ? filtered
      : activeBook.chapters.map((chapter) => chapter.id);
  }, [activeBook, selectedChapterIds]);

  const recentPapers = useMemo(
    () =>
      initialData.papers.filter(
        (paper) => !activeBook || paper.bookId === activeBook.id,
      ),
    [activeBook, initialData.papers],
  );

  const activeReviewPaper = useMemo(
    () =>
      recentPapers.find((paper) => paper.id === selectedReviewPaperId) ??
      recentPapers[0],
    [recentPapers, selectedReviewPaperId],
  );

  const templateDraft = matchingTemplate
    ? templateDrafts[matchingTemplate.id] ?? {
        totalMarks: matchingTemplate.totalMarks,
        durationMinutes: matchingTemplate.durationMinutes,
        instructions: matchingTemplate.instructions ?? "",
        structure: matchingTemplate.structure,
      }
    : null;
  const builderUsedMarks = templateDraft
    ? getStructureTotal(templateDraft.structure)
    : 0;
  const builderRemainingMarks = templateDraft
    ? templateDraft.totalMarks - builderUsedMarks
    : 0;
  const builderMarksReady = Math.abs(builderRemainingMarks) < 0.001;

  function refreshView() {
    startTransition(() => {
      router.refresh();
    });
  }

  function updateTemplateDraft(updater: (draft: TemplateDraft) => TemplateDraft) {
    if (!matchingTemplate) {
      return;
    }

    setTemplateDrafts((current) => {
      const base = current[matchingTemplate.id] ?? {
        totalMarks: matchingTemplate.totalMarks,
        durationMinutes: matchingTemplate.durationMinutes,
        instructions: matchingTemplate.instructions ?? "",
        structure: matchingTemplate.structure,
      };

      return {
        ...current,
        [matchingTemplate.id]: updater(base),
      };
    });
  }

  function updateTemplateSection(
    sectionIndex: number,
    updater: (section: SectionBlueprint) => SectionBlueprint,
  ) {
    updateTemplateDraft((draft) => ({
      ...draft,
      structure: draft.structure.map((section, index) =>
        index === sectionIndex ? updater(section) : section,
      ),
    }));
  }

  function addBuilderBlock(type: QuestionTypeValue, insertIndex?: number) {
    const block = getQuestionBlock(type);
    updateTemplateDraft((draft) => {
      const nextStructure = [...draft.structure];
      const targetIndex = insertIndex ?? nextStructure.length;
      nextStructure.splice(
        targetIndex,
        0,
        createSectionFromBlock(block, nextStructure.length + 1),
      );
      return {
        ...draft,
        structure: nextStructure,
      };
    });
  }

  function duplicateBuilderSection(section: SectionBlueprint, index: number) {
    updateTemplateDraft((draft) => {
      const nextStructure = [...draft.structure];
      nextStructure.splice(index + 1, 0, {
        ...section,
        id: makeSectionId(section.type, index + 1),
        title: `${section.title} copy`,
      });
      return {
        ...draft,
        structure: nextStructure,
      };
    });
  }

  function removeBuilderSection(sectionIndex: number) {
    updateTemplateDraft((draft) => ({
      ...draft,
      structure: draft.structure.filter((_section, index) => index !== sectionIndex),
    }));
  }

  function moveBuilderSection(sectionIndex: number, direction: -1 | 1) {
    updateTemplateDraft((draft) => {
      const targetIndex = sectionIndex + direction;
      if (targetIndex < 0 || targetIndex >= draft.structure.length) {
        return draft;
      }

      return {
        ...draft,
        structure: reorderSections(draft.structure, sectionIndex, targetIndex),
      };
    });
  }

  function handlePaletteDragStart(
    event: DragEvent<HTMLButtonElement>,
    type: QuestionTypeValue,
  ) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(PALETTE_TRANSFER_TYPE, type);
  }

  function handleSectionDragStart(
    event: DragEvent<HTMLDivElement>,
    sectionId: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(SECTION_TRANSFER_TYPE, sectionId);
  }

  function handleBuilderDrop(event: DragEvent<HTMLDivElement>, dropIndex: number) {
    event.preventDefault();
    setDropTargetIndex(null);

    const blockType = event.dataTransfer.getData(PALETTE_TRANSFER_TYPE) as
      | QuestionTypeValue
      | "";
    if (blockType) {
      addBuilderBlock(blockType, dropIndex);
      return;
    }

    const sectionId = event.dataTransfer.getData(SECTION_TRANSFER_TYPE);
    if (!sectionId || !templateDraft) {
      return;
    }

    const fromIndex = templateDraft.structure.findIndex(
      (section) => section.id === sectionId,
    );
    if (fromIndex < 0 || fromIndex === dropIndex) {
      return;
    }

    updateTemplateDraft((draft) => ({
      ...draft,
      structure: reorderSections(
        draft.structure,
        fromIndex,
        fromIndex < dropIndex ? dropIndex - 1 : dropIndex,
      ),
    }));
  }

  async function persistTemplateDraft() {
    if (!matchingTemplate || !templateDraft) {
      throw new Error("No exam blueprint is selected.");
    }

    const response = await fetch(`/api/templates/${matchingTemplate.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(templateDraft),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Could not save the blueprint.");
    }
  }

  async function saveTemplateDraft() {
    if (!matchingTemplate || !templateDraft) {
      return;
    }

    setBusyMessage("Saving the exam blueprint.");
    setNotice(null);

    try {
      await persistTemplateDraft();
      setNotice("Exam blueprint saved.");
      refreshView();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the blueprint.");
    } finally {
      setBusyMessage(null);
    }
  }

  function getQuestionDraft(question: GeneratedPaperData["questions"][number]) {
    return (
      paperDrafts[question.id] ?? {
        prompt: question.prompt,
        answerText: question.answerText ?? "",
      }
    );
  }

  async function savePaperReview(reviewStatus: "DRAFT" | "APPROVED") {
    if (!activeReviewPaper) {
      return;
    }

    setBusyMessage(
      reviewStatus === "APPROVED"
        ? "Running final quality checks and approving the paper."
        : "Saving paper edits and rebuilding the draft DOCX.",
    );
    setNotice(null);

    try {
      const response = await fetch(`/api/papers/${activeReviewPaper.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewStatus,
          questions: activeReviewPaper.questions.map((question) => {
            const draft = getQuestionDraft(question);
            return {
              id: question.id,
              prompt: draft.prompt,
              answerText: draft.answerText.trim() || null,
            };
          }),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        downloadUrl?: string | null;
        qualityReport?: PaperQualityReport;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save the paper.");
      }

      setNotice(
        reviewStatus === "APPROVED"
          ? "Paper approved. The DOCX download should begin now."
          : "Draft saved. Review is still required before export.",
      );
      if (payload.downloadUrl) {
        window.location.href = payload.downloadUrl;
      }
      refreshView();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the paper.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function importSampleBook() {
    setBusyMessage(
      "Importing the bundled sample book and running Bangla OCR. This can take a few minutes.",
    );
    setNotice(null);

    try {
      const response = await fetch("/api/books/sample", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        book?: { id: string };
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Sample import failed.");
      }

      if (payload.book?.id) {
        setSelectedBookId(payload.book.id);
      }
      setNotice("Sample textbook imported and indexed.");
      refreshView();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sample import failed.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function handleUpload(formData: FormData) {
    setBusyMessage(
      "Uploading and indexing the textbook with Bangla OCR. This may take a few minutes.",
    );
    setNotice(null);

    try {
      const response = await fetch("/api/books", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        error?: string;
        book?: { id: string };
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      if (payload.book?.id) {
        setSelectedBookId(payload.book.id);
      }
      setNotice("Book uploaded and indexed successfully.");
      refreshView();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function saveChapter(chapterId: string) {
    const baseChapter = activeBook?.chapters.find((chapter) => chapter.id === chapterId);
    const draft = chapterDrafts[chapterId] ?? {
      title: baseChapter?.title ?? "",
      text: baseChapter?.text ?? "",
    };

    if (!draft.title || !draft.text) {
      return;
    }

    setBusyMessage("Saving chapter edits.");
    setNotice(null);

    try {
      const response = await fetch(`/api/chapters/${chapterId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save chapter changes.");
      }
      setNotice("Chapter changes saved.");
      refreshView();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not save chapter changes.",
      );
    } finally {
      setBusyMessage(null);
    }
  }

  async function reindexCurrentBook() {
    if (!activeBook) {
      return;
    }

    setBusyMessage(
      "Re-indexing the book with Bangla OCR. This can take a few minutes.",
    );
    setNotice(null);

    try {
      const response = await fetch(`/api/books/${activeBook.id}/reindex`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Re-index failed.");
      }
      setNotice("Book re-indexed successfully.");
      refreshView();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Re-index failed.");
    } finally {
      setBusyMessage(null);
    }
  }

  async function generatePaper() {
    if (!activeBook || effectiveSelectedChapterIds.length === 0) {
      setNotice("Select at least one indexed chapter before generating a paper.");
      return;
    }

    if (activeBook.importStatus === "FAILED" || activeBook.importStatus === "INDEXING") {
      setNotice("Finish or fix book indexing before generating a paper.");
      return;
    }

    if (templateDraft && !builderMarksReady) {
      setNotice(
        builderRemainingMarks > 0
          ? `${toBanglaDigits(builderRemainingMarks)} marks still need to be added before generating.`
          : `${toBanglaDigits(Math.abs(builderRemainingMarks))} marks must be removed before generating.`,
      );
      return;
    }

    setBusyMessage("Saving the builder and generating the question paper.");
    setNotice(null);

    try {
      if (matchingTemplate && templateDraft) {
        await persistTemplateDraft();
      }

      const response = await fetch("/api/papers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookId: activeBook.id,
          chapterIds: effectiveSelectedChapterIds,
          examType: selectedExamType,
          allowReuse,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        paperId?: string;
        qualityReport?: PaperQualityReport;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Paper generation failed.");
      }

      if (payload.paperId) {
        setSelectedReviewPaperId(payload.paperId);
      }
      setNotice("Draft generated. Review and approve it before downloading.");
      refreshView();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Paper generation failed.",
      );
    } finally {
      setBusyMessage(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
      <section className="card rounded-[2rem] p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="chip mb-4 w-fit text-xs font-semibold uppercase tracking-[0.22em]">
              <ScanText size={14} />
              FSQuest
            </div>
            <h1 className="section-title text-4xl font-bold tracking-tight text-[var(--foreground)] md:text-5xl">
              Bangla question papers, without the typing pain.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--ink-soft)] md:text-lg">
              Upload a textbook PDF once, index it chapter by chapter with Bangla
              OCR, then generate class test or final term papers in ready-to-print
              DOCX format.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card-strong rounded-3xl px-5 py-4">
              <div className="mono text-xs uppercase tracking-[0.24em] text-[var(--ink-soft)]">
                Books
              </div>
              <div className="mt-2 text-3xl font-bold">
                {initialData.books.length}
              </div>
            </div>
            <div className="card-strong rounded-3xl px-5 py-4">
              <div className="mono text-xs uppercase tracking-[0.24em] text-[var(--ink-soft)]">
                Indexed Chapters
              </div>
              <div className="mt-2 text-3xl font-bold">
                {initialData.books.reduce(
                  (sum, book) => sum + book.chapters.length,
                  0,
                )}
              </div>
            </div>
            <div className="card-strong rounded-3xl px-5 py-4">
              <div className="mono text-xs uppercase tracking-[0.24em] text-[var(--ink-soft)]">
                Generated Papers
              </div>
              <div className="mt-2 text-3xl font-bold">
                {initialData.papers.length}
              </div>
            </div>
          </div>
        </div>
        {(busyMessage || notice || isPending) && (
          <div className="mt-6 rounded-3xl border border-[var(--line)] bg-white/70 px-5 py-4 text-sm leading-7 text-[var(--foreground)]">
            <div className="flex items-start gap-3">
              {(busyMessage || isPending) && (
                <LoaderCircle
                  className="mt-1 shrink-0 animate-spin text-[var(--brand)]"
                  size={18}
                />
              )}
              <div>
                {busyMessage && <p>{busyMessage}</p>}
                {notice && (
                  <p className={busyMessage ? "mt-1 text-[var(--ink-soft)]" : ""}>
                    {notice}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section
        className={`grid gap-6 ${
          focusedSingleChapterMode ? "xl:grid-cols-1" : "xl:grid-cols-[1.05fr_1fr_1fr]"
        }`}
      >
        {!focusedSingleChapterMode && (
        <div className="card rounded-[1.75rem] p-6">
          <div className="flex items-center gap-3">
            <Upload size={18} className="text-[var(--brand)]" />
            <h2 className="section-title text-2xl font-bold">Import A Book</h2>
          </div>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
            Upload a Bangla textbook PDF. The first import runs OCR and saves the
            chapter-wise text for future exams.
          </p>
          <form
            className="mt-5 space-y-4"
            action={async (formData) => {
              await handleUpload(formData);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--ink-soft)]">
                  Book Title
                </label>
                <input
                  className="field"
                  name="title"
                  defaultValue="Bangla Literature"
                  placeholder="e.g. Class 3 Bangla"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--ink-soft)]">
                  Class
                </label>
                <select className="field" name="classLevel" defaultValue="Three">
                  {CLASS_LEVELS.map((classLevel) => (
                    <option key={classLevel} value={classLevel}>
                      {classLevel}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-[var(--ink-soft)]">
                Subject
              </label>
              <input
                className="field"
                name="subject"
                defaultValue={initialData.settings.defaultSubject}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-[var(--ink-soft)]">
                Textbook PDF
              </label>
              <input className="field" type="file" name="pdf" accept=".pdf" required />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                className="btn-primary"
                type="submit"
                disabled={Boolean(busyMessage)}
              >
                <Upload size={16} />
                Upload And Index
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={importSampleBook}
                disabled={Boolean(busyMessage)}
              >
                <BookOpen size={16} />
                Import Workspace Sample
              </button>
            </div>
          </form>
        </div>
        )}

        {!focusedSingleChapterMode && (
        <div className="card rounded-[1.75rem] p-6">
          <div className="flex items-center gap-3">
            <BookOpen size={18} className="text-[var(--accent)]" />
            <h2 className="section-title text-2xl font-bold">Library</h2>
          </div>
          <div className="mt-5 space-y-3">
            {deferredBooks.length === 0 && (
              <div className="rounded-3xl border border-dashed border-[var(--line-strong)] px-4 py-6 text-sm text-[var(--ink-soft)]">
                No books yet. Start by importing the sample book or uploading one of
                your mother&apos;s textbooks.
              </div>
            )}

            {deferredBooks.map((book) => {
              const active = activeBook?.id === book.id;
              return (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => setSelectedBookId(book.id)}
                  className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                    active
                      ? "border-[var(--brand)] bg-white/85 shadow-lg"
                      : "border-[var(--line)] bg-white/55"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold">{book.title}</div>
                      <div className="mt-1 text-sm text-[var(--ink-soft)]">
                        Class {book.classLevel} • {book.subject}
                      </div>
                    </div>
                    <StatusPill status={book.importStatus} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
                    <span className="chip">{book.pageCount} pages</span>
                    <span className="chip">{book.chapters.length} chapters</span>
                    {book.extractionMethod && (
                      <span className="chip">{book.extractionMethod}</span>
                    )}
                  </div>
                  {book.notes && (
                    <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
                      {book.notes}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        )}

        <div className="card rounded-[1.75rem] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-[var(--brand)]" />
                <h2 className="section-title text-2xl font-bold">Question Builder</h2>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">
                Drag Bangla question blocks into the paper, tune the marks, and
                keep the total locked before generating.
              </p>
            </div>
            {templateDraft && (
              <div className="rounded-3xl border border-[var(--line)] bg-white/80 px-4 py-3 text-sm">
                <div className="mono text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  Mark balance
                </div>
                <div className="mt-1 font-bold">
                  {toBanglaDigits(builderUsedMarks)} /{" "}
                  {toBanglaDigits(templateDraft.totalMarks)}
                </div>
                <div
                  className={`mt-1 text-xs font-semibold ${
                    builderMarksReady ? "text-emerald-700" : "text-amber-800"
                  }`}
                >
                  {builderMarksReady
                    ? "Ready to generate"
                    : builderRemainingMarks > 0
                      ? `${toBanglaDigits(builderRemainingMarks)} marks left`
                      : `${toBanglaDigits(Math.abs(builderRemainingMarks))} marks over`}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAM_TYPES.map((examType) => (
              <button
                key={examType}
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  selectedExamType === examType
                    ? "bg-[var(--brand)] text-white"
                    : "bg-white/70 text-[var(--foreground)]"
                }`}
                onClick={() => setSelectedExamType(examType)}
              >
                {formatExamType(examType)}
              </button>
            ))}
          </div>
          <div className="mt-5 space-y-4">
            {!matchingTemplate && (
              <div className="rounded-3xl border border-dashed border-[var(--line)] px-4 py-5 text-sm text-[var(--ink-soft)]">
                No template found for this class and exam type yet.
              </div>
            )}
            {matchingTemplate && templateDraft && (
              <>
                <div className="grid gap-3 md:grid-cols-[0.8fr_0.8fr_1.4fr]">
                  <label className="text-sm font-semibold text-[var(--ink-soft)]">
                    Total Marks
                    <input
                      className="field mt-2"
                      type="number"
                      min={1}
                      value={templateDraft.totalMarks}
                      onChange={(event) =>
                        updateTemplateDraft((draft) => ({
                          ...draft,
                          totalMarks: Number(event.target.value) || draft.totalMarks,
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold text-[var(--ink-soft)]">
                    Time Minutes
                    <input
                      className="field mt-2"
                      type="number"
                      min={1}
                      value={templateDraft.durationMinutes}
                      onChange={(event) =>
                        updateTemplateDraft((draft) => ({
                          ...draft,
                          durationMinutes:
                            Number(event.target.value) || draft.durationMinutes,
                        }))
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold text-[var(--ink-soft)]">
                    Paper Instructions
                    <textarea
                      className="field mt-2 min-h-16"
                      value={templateDraft.instructions}
                      onChange={(event) =>
                        updateTemplateDraft((draft) => ({
                          ...draft,
                          instructions: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="grid gap-4 xl:grid-cols-[0.78fr_1.22fr]">
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/65 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold">Question blocks</div>
                        <p className="text-xs leading-5 text-[var(--ink-soft)]">
                          Drag into the paper, or click plus.
                        </p>
                      </div>
                      <Plus size={17} className="text-[var(--brand)]" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      {QUESTION_BLOCKS.map((block) => (
                        <button
                          key={block.type}
                          type="button"
                          draggable
                          onDragStart={(event) =>
                            handlePaletteDragStart(event, block.type)
                          }
                          onClick={() => addBuilderBlock(block.type)}
                          className="group rounded-3xl border border-[var(--line)] bg-white/80 p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-lg"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold">{block.label}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                                {block.subtitle}
                              </div>
                            </div>
                            <span className="rounded-full bg-[var(--wash)] px-2 py-1 text-xs font-bold text-[var(--brand)]">
                              + Add
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
                            {block.explanation}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    className="rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,.82),rgba(255,250,239,.76))] p-4"
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropTargetIndex(templateDraft.structure.length);
                    }}
                    onDrop={(event) =>
                      handleBuilderDrop(event, templateDraft.structure.length)
                    }
                    onDragLeave={() => setDropTargetIndex(null)}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-bold">Paper canvas</div>
                        <p className="text-xs leading-5 text-[var(--ink-soft)]">
                          Drag to reorder. The mark meter updates instantly.
                        </p>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          builderMarksReady
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {builderMarksReady ? "Balanced" : "Needs mark fix"}
                      </div>
                    </div>

                    {templateDraft.structure.length === 0 && (
                      <div className="mt-4 rounded-3xl border border-dashed border-[var(--line-strong)] bg-white/55 px-4 py-10 text-center text-sm text-[var(--ink-soft)]">
                        Drop question blocks here to start the paper.
                      </div>
                    )}

                    <div className="mt-4 space-y-3">
                      {templateDraft.structure.map((section, sectionIndex) => {
                        const block = getQuestionBlock(section.type);
                        return (
                          <div key={section.id}>
                            <div
                              className={`h-3 rounded-full transition ${
                                dropTargetIndex === sectionIndex
                                  ? "bg-[var(--brand)]/25"
                                  : "bg-transparent"
                              }`}
                              onDragOver={(event) => {
                                event.preventDefault();
                                setDropTargetIndex(sectionIndex);
                              }}
                              onDrop={(event) => handleBuilderDrop(event, sectionIndex)}
                            />
                            <div
                              draggable
                              onDragStart={(event) =>
                                handleSectionDragStart(event, section.id)
                              }
                              className="rounded-3xl border border-[var(--line)] bg-white/90 p-4 shadow-sm transition hover:shadow-lg"
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="flex min-w-0 items-start gap-3">
                                  <GripVertical
                                    className="mt-2 shrink-0 text-[var(--ink-soft)]"
                                    size={18}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full bg-[var(--wash)] px-3 py-1 text-xs font-bold text-[var(--brand)]">
                                        {block.label}
                                      </span>
                                      <span className="mono text-xs text-[var(--ink-soft)]">
                                        {getSectionMarkSummary(section)}
                                      </span>
                                    </div>
                                    <input
                                      className="field mt-3 !py-2 font-semibold"
                                      value={section.title}
                                      onChange={(event) =>
                                        updateTemplateSection(sectionIndex, (current) => ({
                                          ...current,
                                          title: event.target.value,
                                        }))
                                      }
                                    />
                                    <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
                                      {block.explanation}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="btn-secondary !px-3 !py-2 text-xs"
                                    onClick={() => moveBuilderSection(sectionIndex, -1)}
                                    disabled={sectionIndex === 0}
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary !px-3 !py-2 text-xs"
                                    onClick={() => moveBuilderSection(sectionIndex, 1)}
                                    disabled={
                                      sectionIndex === templateDraft.structure.length - 1
                                    }
                                  >
                                    Down
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary !px-3 !py-2 text-xs"
                                    onClick={() =>
                                      duplicateBuilderSection(section, sectionIndex)
                                    }
                                  >
                                    Copy
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary !px-3 !py-2 text-xs"
                                    onClick={() => removeBuilderSection(sectionIndex)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                                  Items
                                  <input
                                    className="field mt-2 !py-2"
                                    type="number"
                                    min={1}
                                    value={section.itemCount}
                                    onChange={(event) =>
                                      updateTemplateSection(sectionIndex, (current) => ({
                                        ...current,
                                        itemCount:
                                          Number(event.target.value) ||
                                          current.itemCount,
                                      }))
                                    }
                                  />
                                </label>
                                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                                  {section.marksPattern ? "Marks Pattern" : "Marks Each"}
                                  <input
                                    className="field mt-2 !py-2"
                                    value={
                                      section.marksPattern?.join(", ") ??
                                      String(section.marksPerItem ?? 1)
                                    }
                                    onChange={(event) =>
                                      updateTemplateSection(sectionIndex, (current) => {
                                        if (current.marksPattern) {
                                          const marksPattern = event.target.value
                                            .split(/[, ]+/)
                                            .map((item) => Number(item))
                                            .filter((item) => item > 0);
                                          return {
                                            ...current,
                                            itemCount:
                                              marksPattern.length || current.itemCount,
                                            marksPattern,
                                            marksPerItem: undefined,
                                          };
                                        }

                                        return {
                                          ...current,
                                          marksPerItem:
                                            Number(event.target.value) ||
                                            current.marksPerItem ||
                                            1,
                                        };
                                      })
                                    }
                                  />
                                </label>
                                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                                  Instructions
                                  <input
                                    className="field mt-2 !py-2"
                                    value={section.instructions ?? ""}
                                    onChange={(event) =>
                                      updateTemplateSection(sectionIndex, (current) => ({
                                        ...current,
                                        instructions: event.target.value || undefined,
                                      }))
                                    }
                                  />
                                </label>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div
                        className={`rounded-3xl border border-dashed px-4 py-5 text-center text-sm transition ${
                          dropTargetIndex === templateDraft.structure.length
                            ? "border-[var(--brand)] bg-[var(--wash)] text-[var(--brand)]"
                            : "border-[var(--line)] text-[var(--ink-soft)]"
                        }`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDropTargetIndex(templateDraft.structure.length);
                        }}
                        onDrop={(event) =>
                          handleBuilderDrop(event, templateDraft.structure.length)
                        }
                      >
                        Drop here to add at the end
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={Boolean(busyMessage) || !builderMarksReady}
                        onClick={saveTemplateDraft}
                      >
                        <Save size={16} />
                        Save Builder
                      </button>
                      {!builderMarksReady && (
                        <p className="text-sm leading-7 text-[var(--ink-soft)]">
                          Match the block marks to the total before saving or generating.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="card rounded-[1.75rem] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <Sparkles size={18} className="text-[var(--accent)]" />
                <h2 className="section-title text-2xl font-bold">Generate Paper</h2>
              </div>
              <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
                Pick the indexed chapters and create a ready-to-print DOCX exam
                paper.
              </p>
            </div>
            {activeBook && !focusedSingleChapterMode && (
              <button
                type="button"
                className="btn-secondary"
                onClick={reindexCurrentBook}
                disabled={Boolean(busyMessage)}
              >
                <RefreshCcw size={16} />
                Re-index Book
              </button>
            )}
          </div>

          {!activeBook && (
            <div className="mt-5 rounded-3xl border border-dashed border-[var(--line-strong)] px-4 py-6 text-sm text-[var(--ink-soft)]">
              Import a book first to unlock question generation.
            </div>
          )}

          {activeBook && (
            <>
              <div className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                <div className="font-semibold">{activeBook.title}</div>
                <div className="mt-1 text-sm text-[var(--ink-soft)]">
                  Class {activeBook.classLevel} • {activeBook.subject}
                </div>
              </div>

              {focusedSingleChapterMode && activeBook.chapters[0] && (
                <div className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    Focused chapter
                  </div>
                  <div className="mt-2 font-semibold">{activeBook.chapters[0].title}</div>
                  <div className="mt-1 text-sm text-[var(--ink-soft)]">
                    Pages {activeBook.chapters[0].startPage ?? "?"} -{" "}
                    {activeBook.chapters[0].endPage ?? "?"} · Quality{" "}
                    {activeBook.chapters[0].quality.score}/100
                  </div>
                </div>
              )}

              {!focusedSingleChapterMode && (
              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Select Chapters</h3>
                  <button
                    type="button"
                    className="text-sm font-semibold text-[var(--brand)]"
                    onClick={() =>
                      setSelectedChapterIds(
                        effectiveSelectedChapterIds.length ===
                          activeBook.chapters.length
                          ? []
                          : activeBook.chapters.map((chapter) => chapter.id),
                      )
                    }
                  >
                    {effectiveSelectedChapterIds.length === activeBook.chapters.length
                      ? "Clear all"
                      : "Select all"}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeBook.chapters.map((chapter) => {
                    const checked = effectiveSelectedChapterIds.includes(chapter.id);
                    return (
                      <label
                        key={chapter.id}
                        className={`rounded-3xl border p-4 transition ${
                          checked
                            ? "border-[var(--brand)] bg-white/90"
                            : "border-[var(--line)] bg-white/65"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-[var(--brand)]"
                            checked={checked}
                            onChange={(event) => {
                              setSelectedChapterIds((current) =>
                                event.target.checked
                                  ? [...current, chapter.id]
                                  : current.filter((id) => id !== chapter.id),
                              );
                            }}
                          />
                          <div>
                            <div className="font-semibold">{chapter.title}</div>
                            <div className="mt-1 text-xs text-[var(--ink-soft)]">
                              Pages {chapter.startPage ?? "?"} - {chapter.endPage ?? "?"}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <span
                                className={`chip ${
                                  chapter.quality.status === "ready"
                                    ? "bg-emerald-50 text-emerald-800"
                                    : chapter.quality.status === "needs_review"
                                      ? "bg-amber-50 text-amber-800"
                                      : "bg-rose-50 text-rose-800"
                                }`}
                              >
                                Quality {chapter.quality.score}/100
                              </span>
                              {chapter.quality.issues[0] && (
                                <span className="text-[var(--ink-soft)]">
                                  {chapter.quality.issues[0].message}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              )}

              <div className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={allowReuse}
                    onChange={(event) => setAllowReuse(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[var(--brand)]"
                  />
                  <span className="text-sm leading-7 text-[var(--ink-soft)]">
                    Allow question reuse from previously generated papers. Leave
                    this off for CT papers when you want fresh questions only.
                  </span>
                </label>
              </div>

              <div className="mt-5">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={generatePaper}
                  disabled={
                    Boolean(busyMessage) ||
                    activeBook.importStatus === "FAILED" ||
                    activeBook.importStatus === "INDEXING" ||
                    !builderMarksReady
                  }
                >
                  <Sparkles size={16} />
                  Generate DOCX Paper
                </button>
              </div>
            </>
          )}
        </div>

        <div className="card rounded-[1.75rem] p-6">
          <div className="flex items-center gap-3">
            <Download size={18} className="text-[var(--brand)]" />
            <h2 className="section-title text-2xl font-bold">Recent Papers</h2>
          </div>
          <div className="mt-5 space-y-3">
            {recentPapers.length === 0 && (
              <div className="rounded-3xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--ink-soft)]">
                No generated papers yet for the selected book.
              </div>
            )}
            {recentPapers.map((paper) => (
              <div
                key={paper.id}
                className="rounded-3xl border border-[var(--line)] bg-white/70 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold">{paper.title}</div>
                      <PaperStatusPill status={paper.reviewStatus} />
                    </div>
                    <div className="mt-1 text-sm text-[var(--ink-soft)]">
                      {formatExamType(paper.examType)} •{" "}
                      {formatAppDate(paper.createdAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary !px-4 !py-2 text-sm"
                      onClick={() => setSelectedReviewPaperId(paper.id)}
                    >
                      Review
                    </button>
                    {paper.reviewStatus === "APPROVED" && (
                      <a
                        href={`/api/papers/${paper.id}/download`}
                        className="btn-secondary !px-4 !py-2 text-sm"
                      >
                        <Download size={14} />
                        DOCX
                      </a>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-xs text-[var(--ink-soft)]">
                  Chapters: {paper.includedChapterIds.length} • Questions:{" "}
                  {paper.questions.length} • Quality:{" "}
                  {paper.qualityReport?.score ?? "not checked"}/100
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {activeReviewPaper && (
        <section className="card rounded-[1.75rem] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <Sparkles size={18} className="text-[var(--accent)]" />
                <h2 className="section-title text-2xl font-bold">
                  Review, Edit, Approve
                </h2>
                <PaperStatusPill status={activeReviewPaper.reviewStatus} />
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">
                This is the safety gate. Fix any awkward question text here,
                then approve the paper only when it is ready for your mother to
                print.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={Boolean(busyMessage)}
                onClick={() => savePaperReview("DRAFT")}
              >
                <Save size={16} />
                Save Draft
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={Boolean(busyMessage)}
                onClick={() => savePaperReview("APPROVED")}
              >
                <Download size={16} />
                Approve & Export
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-3xl border border-[var(--line)] bg-white/70 px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="font-semibold">{activeReviewPaper.title}</div>
              <span className="chip">
                Quality {activeReviewPaper.qualityReport?.score ?? "not checked"}/100
              </span>
            </div>
            {activeReviewPaper.qualityReport?.issues.length ? (
              <div className="mt-3 grid gap-2">
                {activeReviewPaper.qualityReport.issues.slice(0, 6).map((issue, index) => (
                  <div
                    key={`${issue.message}-${index}`}
                    className={`rounded-2xl px-3 py-2 text-sm ${
                      issue.severity === "error"
                        ? "bg-rose-50 text-rose-800"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {issue.message}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-emerald-800">
                No quality issues found on the last check.
              </p>
            )}
          </div>

          <div className="mt-5 grid gap-4">
            {activeReviewPaper.questions.map((question) => {
              const draft = getQuestionDraft(question);
              return (
                <div
                  key={question.id}
                  className="rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="font-semibold">
                      {question.sectionTitle}
                      {question.subLabel ? ` (${question.subLabel})` : ""}
                    </div>
                    <div className="mono text-xs text-[var(--ink-soft)]">
                      {question.marks} mark{question.marks === 1 ? "" : "s"}
                    </div>
                  </div>
                  <label className="block text-sm font-semibold text-[var(--ink-soft)]">
                    Student-facing question
                    <textarea
                      className="field mt-2 min-h-24"
                      value={draft.prompt}
                      onChange={(event) =>
                        setPaperDrafts((current) => ({
                          ...current,
                          [question.id]: {
                            ...draft,
                            prompt: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="mt-3 block text-sm font-semibold text-[var(--ink-soft)]">
                    Teacher answer / expected response
                    <textarea
                      className="field mt-2 min-h-20"
                      value={draft.answerText}
                      onChange={(event) =>
                        setPaperDrafts((current) => ({
                          ...current,
                          [question.id]: {
                            ...draft,
                            answerText: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  {question.sourceExcerpt && (
                    <p className="mt-3 text-xs leading-6 text-[var(--ink-soft)]">
                      Source clue: {question.sourceExcerpt}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeBook && !focusedSingleChapterMode && (
        <section className="card rounded-[1.75rem] p-6">
          <div className="flex items-center gap-3">
            <Save size={18} className="text-[var(--accent)]" />
            <h2 className="section-title text-2xl font-bold">
              Review Indexed Chapters
            </h2>
          </div>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
            OCR and chapter splitting are rarely perfect. This editor lets you
            correct a title or chapter text before generating papers.
          </p>
          <div className="mt-5 space-y-4">
            {activeBook.chapters.map((chapter) => {
              const draft = chapterDrafts[chapter.id] ?? {
                title: chapter.title,
                text: chapter.text,
              };
              return (
                <details
                  key={chapter.id}
                  className="rounded-[1.5rem] border border-[var(--line)] bg-white/70 px-4 py-4"
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold">{draft.title}</div>
                        <div className="mt-1 text-sm text-[var(--ink-soft)]">
                          Pages {chapter.startPage ?? "?"} - {chapter.endPage ?? "?"}
                        </div>
                        <div className="mt-2 text-xs text-[var(--ink-soft)]">
                          Quality {chapter.quality.score}/100 ·{" "}
                          {chapter.quality.status.replace("_", " ")}
                        </div>
                        {chapter.quality.issues[0] && (
                          <div className="mt-1 text-xs text-amber-800">
                            {chapter.quality.issues[0].message}
                          </div>
                        )}
                      </div>
                      <span className="mono text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                        Edit
                      </span>
                    </div>
                  </summary>

                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[var(--ink-soft)]">
                        Chapter Title
                      </label>
                      <input
                        className="field"
                        value={draft.title}
                        onChange={(event) =>
                          setChapterDrafts((current) => ({
                            ...current,
                            [chapter.id]: {
                              ...draft,
                              title: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[var(--ink-soft)]">
                        Chapter Text
                      </label>
                      <textarea
                        className="field min-h-64"
                        value={draft.text}
                        onChange={(event) =>
                          setChapterDrafts((current) => ({
                            ...current,
                            [chapter.id]: {
                              ...draft,
                              text: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => saveChapter(chapter.id)}
                        disabled={Boolean(busyMessage)}
                      >
                        <Save size={16} />
                        Save Chapter
                      </button>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
