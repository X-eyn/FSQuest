import { randomUUID } from "node:crypto";

import { ExamType, PaperReviewStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildQuestionPaperDocx } from "@/lib/docx";
import { parseExamStructure } from "@/lib/exam";
import { generateQuestionDrafts } from "@/lib/generator";
import { prisma } from "@/lib/prisma";
import { assessChapterQuality, buildPaperQualityReport } from "@/lib/quality";
import { writeGeneratedDocx } from "@/lib/storage";

const paperSchema = z.object({
  bookId: z.string().min(1),
  chapterIds: z.array(z.string().min(1)).min(1),
  examType: z.enum(["CT1", "CT2", "CT3", "CT4", "FINAL_TERM"]),
  allowReuse: z.boolean().optional().default(false),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = paperSchema.parse(await request.json());
    const book = await prisma.book.findUnique({
      where: { id: payload.bookId },
      include: {
        chapters: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    });

    if (!book) {
      return NextResponse.json({ error: "Book not found." }, { status: 404 });
    }

    if (book.importStatus !== "INDEXED") {
      return NextResponse.json(
        { error: "This book must finish indexing before paper generation." },
        { status: 409 },
      );
    }

    const selectedChapters = book.chapters.filter((chapter) =>
      payload.chapterIds.includes(chapter.id),
    );

    if (selectedChapters.length === 0) {
      return NextResponse.json(
        { error: "No indexed chapters were selected." },
        { status: 400 },
      );
    }

    const template = await prisma.examTemplate.findUnique({
      where: {
        classLevel_examType: {
          classLevel: book.classLevel,
          examType: payload.examType as ExamType,
        },
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "No exam template exists for this class and exam type." },
        { status: 404 },
      );
    }

    const priorPrompts =
      payload.examType !== "FINAL_TERM" && !payload.allowReuse
        ? await prisma.generatedQuestion.findMany({
            where: {
              chapterId: {
                in: selectedChapters.map((chapter) => chapter.id),
              },
              paper: {
                classLevel: book.classLevel,
                subject: book.subject,
                examType: {
                  in: [ExamType.CT1, ExamType.CT2, ExamType.CT3, ExamType.CT4],
                },
              },
            },
            select: {
              prompt: true,
            },
          })
        : [];

    const questionDrafts = await generateQuestionDrafts({
      selectedChapters,
      template,
      usedPrompts: priorPrompts.map((item) => item.prompt),
    });

    if (questionDrafts.length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not generate fresh questions from the selected chapters. Try selecting more chapters or allowing reuse.",
        },
        { status: 400 },
      );
    }

    const structure = parseExamStructure(template.structureJson);
    const qualityReport = buildPaperQualityReport({
      questions: questionDrafts,
      structure,
      totalMarks: template.totalMarks,
      chapterSummaries: selectedChapters.map((chapter) =>
        assessChapterQuality({
          title: chapter.title,
          text: chapter.text,
          excerpt: chapter.excerpt,
        }),
      ),
    });

    if (qualityReport.status === "blocked") {
      return NextResponse.json(
        {
          error:
            qualityReport.issues.find((issue) => issue.severity === "error")
              ?.message ??
            "Generated paper failed quality checks. Review the chapter text and try again.",
          qualityReport,
        },
        { status: 422 },
      );
    }

    const settings = await prisma.appSetting.findUnique({
      where: { id: "default" },
    });

    if (!settings) {
      throw new Error("App settings are not initialized. Run the database setup first.");
    }

    const paperId = randomUUID();
    const previewPaper = {
      title: `${book.subject} ${payload.examType} - Class ${book.classLevel}`,
      classLevel: book.classLevel,
      subject: book.subject,
      examType: payload.examType,
      totalMarks: template.totalMarks,
      questions: questionDrafts.map((question, index) => ({
        id: `${paperId}-${index + 1}`,
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
    } as const;

    const docxBuffer = await buildQuestionPaperDocx({
      settings: {
        schoolName: settings.schoolName,
        schoolTagline: settings.schoolTagline,
        defaultSubject: settings.defaultSubject,
        defaultExamMinutes: settings.defaultExamMinutes,
      },
      template: {
        id: template.id,
        classLevel: template.classLevel,
        examType: template.examType,
        displayName: template.displayName,
        totalMarks: template.totalMarks,
        durationMinutes: template.durationMinutes,
        instructions: template.instructions,
        structure,
      },
      paper: previewPaper,
    });

    const docxPath = await writeGeneratedDocx(
      paperId,
      `${book.classLevel}-${payload.examType}-${book.subject}`,
      docxBuffer,
    );

    await prisma.generatedPaper.create({
      data: {
        id: paperId,
        bookId: book.id,
        templateId: template.id,
        classLevel: book.classLevel,
        subject: book.subject,
        examType: payload.examType as ExamType,
        title: previewPaper.title,
        totalMarks: template.totalMarks,
        includedChapterIds: JSON.stringify(payload.chapterIds),
        allowReuse: payload.allowReuse,
        docxPath,
        reviewStatus: PaperReviewStatus.DRAFT,
        qualityReportJson: JSON.stringify(qualityReport),
        notes: "Review and approve this draft before exporting the final DOCX.",
        questions: {
          create: questionDrafts.map((question) => ({
            chapterId: question.chapterId,
            sectionKey: question.sectionKey,
            sectionTitle: question.sectionTitle,
            itemOrder: question.itemOrder,
            subLabel: question.subLabel,
            questionType: question.questionType,
            prompt: question.prompt,
            answerText: question.answerText,
            marks: question.marks,
            sourceExcerpt: question.sourceExcerpt,
            metadataJson: question.metadataJson,
          })),
        },
      },
    });

    return NextResponse.json({
      paperId,
      reviewStatus: PaperReviewStatus.DRAFT,
      qualityReport,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid paper generation request.", issues: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not generate the question paper.",
      },
      { status: 500 },
    );
  }
}
