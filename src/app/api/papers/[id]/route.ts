import { PaperReviewStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildQuestionPaperDocx } from "@/lib/docx";
import { parseExamStructure } from "@/lib/exam";
import { prisma } from "@/lib/prisma";
import {
  assessChapterQuality,
  buildPaperQualityReport,
  getApprovalBlocker,
} from "@/lib/quality";
import { writeGeneratedDocx } from "@/lib/storage";

const questionEditSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().trim().min(1),
  answerText: z.string().trim().nullable().optional(),
});

const paperPatchSchema = z.object({
  reviewStatus: z.enum(["DRAFT", "APPROVED"]).optional(),
  questions: z.array(questionEditSchema).optional(),
});

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = paperPatchSchema.parse(await request.json());

    const paper = await prisma.generatedPaper.findUnique({
      where: { id },
      include: {
        book: {
          include: {
            chapters: true,
          },
        },
        template: true,
        questions: {
          orderBy: [
            { sectionKey: "asc" },
            { itemOrder: "asc" },
          ],
        },
      },
    });

    if (!paper) {
      return NextResponse.json({ error: "Paper not found." }, { status: 404 });
    }

    if (!paper.template) {
      throw new Error("The exam template used by this paper no longer exists.");
    }

    const edits = new Map((payload.questions ?? []).map((question) => [question.id, question]));
    const mergedQuestions = paper.questions.map((question) => {
      const edit = edits.get(question.id);
      return {
        ...question,
        prompt: edit?.prompt ?? question.prompt,
        answerText:
          edit && "answerText" in edit
            ? edit.answerText?.trim() || null
            : question.answerText,
      };
    });

    const structure = parseExamStructure(paper.template.structureJson);
    const includedChapterIds = JSON.parse(paper.includedChapterIds) as string[];
    const selectedChapters = paper.book.chapters.filter((chapter) =>
      includedChapterIds.includes(chapter.id),
    );
    const qualityReport = buildPaperQualityReport({
      questions: mergedQuestions,
      structure,
      totalMarks: paper.totalMarks,
      chapterSummaries: selectedChapters.map((chapter) =>
        assessChapterQuality({
          title: chapter.title,
          text: chapter.text,
          excerpt: chapter.excerpt,
        }),
      ),
    });

    const requestedStatus = payload.reviewStatus ?? paper.reviewStatus;
    const blocker =
      requestedStatus === PaperReviewStatus.APPROVED
        ? getApprovalBlocker(qualityReport)
        : null;

    if (blocker) {
      return NextResponse.json(
        {
          error: blocker,
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
    const docxBuffer = await buildQuestionPaperDocx({
      settings: {
        schoolName: settings.schoolName,
        schoolTagline: settings.schoolTagline,
        defaultSubject: settings.defaultSubject,
        defaultExamMinutes: settings.defaultExamMinutes,
      },
      template: {
        id: paper.template.id,
        classLevel: paper.template.classLevel,
        examType: paper.template.examType,
        displayName: paper.template.displayName,
        totalMarks: paper.template.totalMarks,
        durationMinutes: paper.template.durationMinutes,
        instructions: paper.template.instructions,
        structure,
      },
      paper: {
        title: paper.title,
        classLevel: paper.classLevel,
        subject: paper.subject,
        examType: paper.examType,
        totalMarks: paper.totalMarks,
        questions: mergedQuestions.map((question) => ({
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
      },
    });
    const docxPath = await writeGeneratedDocx(
      paper.id,
      `${paper.classLevel}-${paper.examType}-${paper.subject}`,
      docxBuffer,
    );

    await prisma.$transaction([
      ...mergedQuestions.map((question) =>
        prisma.generatedQuestion.update({
          where: { id: question.id },
          data: {
            prompt: question.prompt.trim(),
            answerText: question.answerText?.trim() || null,
          },
        }),
      ),
      prisma.generatedPaper.update({
        where: { id: paper.id },
        data: {
          docxPath,
          reviewStatus: requestedStatus,
          qualityReportJson: JSON.stringify(qualityReport),
          approvedAt:
            requestedStatus === PaperReviewStatus.APPROVED ? new Date() : null,
          notes:
            requestedStatus === PaperReviewStatus.APPROVED
              ? "Approved for export."
              : "Review and approve this draft before exporting the final DOCX.",
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      reviewStatus: requestedStatus,
      qualityReport,
      downloadUrl:
        requestedStatus === PaperReviewStatus.APPROVED
          ? `/api/papers/${paper.id}/download`
          : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid paper update request.", issues: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not update the paper.",
      },
      { status: 500 },
    );
  }
}
