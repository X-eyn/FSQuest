import { parseExamStructure } from "@/lib/exam";
import { prisma } from "@/lib/prisma";
import { assessChapterQuality } from "@/lib/quality";
import { safeJsonParse } from "@/lib/utils";
import type { DashboardData, PaperQualityReport } from "@/types/domain";

export async function getDashboardData(): Promise<DashboardData> {
  const [settings, books, templates, papers] = await Promise.all([
    prisma.appSetting.findUniqueOrThrow({
      where: { id: "default" },
    }),
    prisma.book.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        chapters: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    }),
    prisma.examTemplate.findMany({
      orderBy: [{ classLevel: "asc" }, { examType: "asc" }],
    }),
    prisma.generatedPaper.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 8,
      include: {
        questions: {
          orderBy: [
            {
              sectionKey: "asc",
            },
            {
              itemOrder: "asc",
            },
          ],
        },
      },
    }),
  ]);

  return {
    settings: {
      schoolName: settings.schoolName,
      schoolTagline: settings.schoolTagline,
      defaultSubject: settings.defaultSubject,
      defaultExamMinutes: settings.defaultExamMinutes,
    },
    books: books.map((book) => ({
      id: book.id,
      title: book.title,
      classLevel: book.classLevel,
      subject: book.subject,
      pageCount: book.pageCount,
      importStatus: book.importStatus,
      extractionMethod: book.extractionMethod,
      notes: book.notes,
      indexedAt: book.indexedAt?.toISOString() ?? null,
      createdAt: book.createdAt.toISOString(),
      chapters: book.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        sortOrder: chapter.sortOrder,
        startPage: chapter.startPage,
        endPage: chapter.endPage,
        excerpt: chapter.excerpt,
        text: chapter.text,
        quality: assessChapterQuality({
          title: chapter.title,
          text: chapter.text,
          excerpt: chapter.excerpt,
        }),
        updatedAt: chapter.updatedAt.toISOString(),
      })),
    })),
    templates: templates.map((template) => ({
      id: template.id,
      classLevel: template.classLevel,
      examType: template.examType,
      displayName: template.displayName,
      totalMarks: template.totalMarks,
      durationMinutes: template.durationMinutes,
      instructions: template.instructions,
      structure: parseExamStructure(template.structureJson),
    })),
    papers: papers.map((paper) => ({
      id: paper.id,
      bookId: paper.bookId,
      classLevel: paper.classLevel,
      subject: paper.subject,
      examType: paper.examType,
      title: paper.title,
      totalMarks: paper.totalMarks,
      includedChapterIds: JSON.parse(paper.includedChapterIds) as string[],
      allowReuse: paper.allowReuse,
      docxPath: paper.docxPath,
      reviewStatus: paper.reviewStatus,
      approvedAt: paper.approvedAt?.toISOString() ?? null,
      qualityReport: paper.qualityReportJson
        ? safeJsonParse<PaperQualityReport | null>(paper.qualityReportJson, null)
        : null,
      createdAt: paper.createdAt.toISOString(),
      templateId: paper.templateId,
      questions: paper.questions.map((question) => ({
        id: question.id,
        sectionKey: question.sectionKey,
        sectionTitle: question.sectionTitle,
        itemOrder: question.itemOrder,
        subLabel: question.subLabel,
        questionType: question.questionType,
        prompt: question.prompt,
        answerText: question.answerText,
        marks: question.marks,
        sourceExcerpt: question.sourceExcerpt,
      })),
    })),
  };
}
