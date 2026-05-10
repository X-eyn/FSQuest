import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from "docx";

import { formatExamType, getSectionMarkSummary, toBanglaDigits } from "@/lib/utils";
import { safeJsonParse } from "@/lib/utils";
import type { AppSettingData, ExamTemplateData, GeneratedPaperData, SectionBlueprint } from "@/types/domain";

function run(text: string, options?: { bold?: boolean; size?: number; color?: string }) {
  return new TextRun({
    text,
    bold: options?.bold,
    size: options?.size,
    color: options?.color,
    font: "Nirmala UI",
  });
}

export async function buildQuestionPaperDocx(params: {
  settings: AppSettingData;
  template: ExamTemplateData;
  paper: Pick<
    GeneratedPaperData,
    "title" | "classLevel" | "subject" | "examType" | "totalMarks" | "questions"
  >;
}) {
  const { settings, template, paper } = params;
  const sections = safeJsonParse<SectionBlueprint[]>(
    JSON.stringify(template.structure),
    [],
  );
  const groupedQuestions = sections.map((section) => ({
    section,
    items: paper.questions
      .filter((question) => question.sectionKey === section.id)
      .sort((a, b) => a.itemOrder - b.itemOrder),
  }));

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run(settings.schoolName, { bold: true, size: 32, color: "1d2d2a" })],
    }),
  ];

  if (settings.schoolTagline) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [run(settings.schoolTagline, { size: 18, color: "5c6c67" })],
      }),
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 100 },
      children: [
        run(`Subject: ${paper.subject}    Examination: ${formatExamType(paper.examType)}`, {
          bold: true,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        run(`Class: ${paper.classLevel}    Total Marks: ${toBanglaDigits(paper.totalMarks)}`, {
          bold: true,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
      spacing: { after: 40 },
      children: [
        run("Date: ____________________", { size: 22 }),
        new Tab(),
        run(`Time Allowed: ${template.durationMinutes} minutes`, { size: 22 }),
      ],
    }),
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
      spacing: { after: 220 },
      children: [
        run("Student Name: ____________________", { size: 22 }),
        new Tab(),
        run("Student No.: ____________________", { size: 22 }),
      ],
    }),
  );

  groupedQuestions.forEach((group, sectionIndex) => {
    if (group.items.length === 0) {
      return;
    }

    children.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
        spacing: { before: 120, after: 80 },
        children: [
          run(`${toBanglaDigits(sectionIndex + 1)}। ${group.section.title}`, {
            bold: true,
            size: 24,
          }),
          new Tab(),
          run(getSectionMarkSummary(group.section), {
            bold: true,
            size: 22,
            color: "5c6c67",
          }),
        ],
      }),
    );

    if (group.section.instructions) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [run(`(${group.section.instructions})`, { size: 20, color: "5c6c67" })],
        }),
      );
    }

    group.items.forEach((item) => {
      const text =
        item.subLabel && group.items.length > 1
          ? `(${item.subLabel}) ${item.prompt}`
          : item.prompt;
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          indent: group.items.length > 1 ? { left: 240 } : undefined,
          children: [run(text, { size: 22 })],
        }),
      );
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
