import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const root = process.cwd();
const dbPath = path.join(root, "prisma", "dev.db");
const storageRoot = path.join(root, "storage");
const db = new Database(dbPath, { readonly: true });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getSectionMarks(section, index) {
  return section.marksPattern?.[index] ?? section.marksPerItem ?? 1;
}

const paperColumns = db.prepare('PRAGMA table_info("GeneratedPaper")').all();
for (const column of ["reviewStatus", "qualityReportJson", "approvedAt", "updatedAt"]) {
  assert(
    paperColumns.some((item) => item.name === column),
    `GeneratedPaper.${column} is missing`,
  );
}

for (const template of db.prepare("SELECT id,totalMarks,structureJson FROM ExamTemplate").all()) {
  const structure = JSON.parse(template.structureJson);
  const total = structure.reduce(
    (sum, section) =>
      sum +
      Array.from({ length: section.itemCount }).reduce(
        (sectionSum, _item, index) => sectionSum + getSectionMarks(section, index),
        0,
      ),
    0,
  );
  assert(
    Math.abs(total - template.totalMarks) < 0.001,
    `Template ${template.id} marks add up to ${total}, not ${template.totalMarks}`,
  );
}

for (const paper of db
  .prepare("SELECT id,title,docxPath,reviewStatus,qualityReportJson FROM GeneratedPaper")
  .all()) {
  const docxPath = path.join(storageRoot, paper.docxPath);
  assert(fs.existsSync(docxPath), `Missing DOCX for paper ${paper.title}`);

  if (paper.reviewStatus !== "APPROVED") {
    continue;
  }

  assert(paper.qualityReportJson, `Approved paper ${paper.id} has no quality report`);
  const report = JSON.parse(paper.qualityReportJson);
  assert(
    report.status !== "blocked",
    `Approved paper ${paper.id} still has blocking quality issues`,
  );

  const questions = db
    .prepare("SELECT questionType,prompt,answerText FROM GeneratedQuestion WHERE paperId = ?")
    .all(paper.id);
  for (const question of questions) {
    assert(/[\u0980-\u09FF]/u.test(question.prompt), `Approved paper ${paper.id} has a non-Bangla prompt`);
    assert(
      !/[A-Za-z]{2,}|[0-9\u09E6-\u09EF]{6,}/u.test(question.prompt),
      `Approved paper ${paper.id} has OCR noise in a prompt`,
    );
    if (["WORD_MEANING", "ANTONYM", "SHORT_ANSWER"].includes(question.questionType)) {
      assert(question.answerText, `Approved paper ${paper.id} is missing a teacher answer`);
    }
    if (question.questionType === "SHORT_ANSWER") {
      assert(
        question.answerText.length >= 12,
        `Approved paper ${paper.id} has a weak short-answer answer`,
      );
    }
  }
}

db.close();
console.log("Quality checks passed.");
