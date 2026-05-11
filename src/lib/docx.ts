import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
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

  // Subject / exam line
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
      tabStops: [{ type: TabStopType.RIGHT, position: 8640 }],
      spacing: { after: 40 },
      children: [
        run("Date: ____________________", { size: 22 }),
        new Tab(),
        run(`Time Allowed: ${template.durationMinutes} minutes`, { size: 22 }),
      ],
    }),
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 8640 }],
      spacing: { after: 60 },
      children: [
        run("Student Name: ____________________", { size: 22 }),
        new Tab(),
        run("Student No.: ____________________", { size: 22 }),
      ],
    }),
    // Horizontal rule separating header from questions
    new Paragraph({
      spacing: { after: 200 },
      border: {
        bottom: { color: "1d2d2a", style: BorderStyle.SINGLE, size: 6, space: 4 },
      },
      children: [],
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
        properties: {
          page: {
            // A4: 210 × 297 mm in twips (1 mm = 56.69 twips)
            size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
            // Margins: 18mm top/bottom, 20mm left/right — comfortable for primary school papers
            margin: { top: 1020, bottom: 1020, left: 1134, right: 1134 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
