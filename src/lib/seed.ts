import { ExamType } from "@prisma/client";

import { CLASS_LEVELS, getDefaultDurationMinutes, getDefaultExamStructure, getDefaultTotalMarks } from "@/lib/exam";
import { prisma } from "@/lib/prisma";

const EXAM_TYPES: ExamType[] = [
  ExamType.CT1,
  ExamType.CT2,
  ExamType.CT3,
  ExamType.CT4,
  ExamType.FINAL_TERM,
];

export async function ensureSeedData() {
  await prisma.appSetting.upsert({
    where: { id: "default" },
    update: {
      schoolName: "Foundation School & College",
      schoolTagline: null,
      defaultSubject: "Bangla Literature",
      defaultExamMinutes: 40,
    },
    create: {
      id: "default",
      schoolName: "Foundation School & College",
      schoolTagline: null,
      defaultSubject: "Bangla Literature",
      defaultExamMinutes: 40,
    },
  });

  for (const classLevel of CLASS_LEVELS) {
    for (const examType of EXAM_TYPES) {
      await prisma.examTemplate.upsert({
        where: {
          classLevel_examType: {
            classLevel,
            examType,
          },
        },
        update: {},
        create: {
          classLevel,
          examType,
          displayName:
            examType === ExamType.FINAL_TERM
              ? `${classLevel} Final Term`
              : `${classLevel} ${examType}`,
          totalMarks: getDefaultTotalMarks(examType),
          durationMinutes: getDefaultDurationMinutes(examType),
          instructions:
            "প্রশ্নের উত্তর পরিষ্কারভাবে লেখ। শুদ্ধ বানান ও পরিচ্ছন্ন লেখা বজায় রাখ।",
          structureJson: JSON.stringify(getDefaultExamStructure(examType)),
        },
      });
    }
  }
}
