CREATE TABLE IF NOT EXISTS "AppSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schoolName" TEXT NOT NULL,
  "schoolTagline" TEXT,
  "defaultSubject" TEXT NOT NULL,
  "defaultExamMinutes" INTEGER NOT NULL DEFAULT 40,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Book" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "classLevel" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "pdfFileName" TEXT NOT NULL,
  "pdfStoragePath" TEXT NOT NULL,
  "rawTextPath" TEXT,
  "pageCount" INTEGER NOT NULL DEFAULT 0,
  "importStatus" TEXT NOT NULL DEFAULT 'UPLOADED',
  "extractionMethod" TEXT,
  "notes" TEXT,
  "indexedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Chapter" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "startPage" INTEGER,
  "endPage" INTEGER,
  "excerpt" TEXT,
  "text" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Chapter_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ExamTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "classLevel" TEXT NOT NULL,
  "examType" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "totalMarks" INTEGER NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "instructions" TEXT,
  "structureJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "GeneratedPaper" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookId" TEXT NOT NULL,
  "templateId" TEXT,
  "classLevel" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "examType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "totalMarks" INTEGER NOT NULL,
  "includedChapterIds" TEXT NOT NULL,
  "allowReuse" BOOLEAN NOT NULL DEFAULT false,
  "docxPath" TEXT NOT NULL,
  "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  "qualityReportJson" TEXT,
  "approvedAt" DATETIME,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedPaper_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeneratedPaper_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExamTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "GeneratedQuestion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "paperId" TEXT NOT NULL,
  "chapterId" TEXT,
  "sectionKey" TEXT NOT NULL,
  "sectionTitle" TEXT NOT NULL,
  "itemOrder" INTEGER NOT NULL,
  "subLabel" TEXT,
  "questionType" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "answerText" TEXT,
  "marks" REAL NOT NULL,
  "sourceExcerpt" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "GeneratedPaper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeneratedQuestion_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Chapter_bookId_sortOrder_key"
ON "Chapter"("bookId", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "ExamTemplate_classLevel_examType_key"
ON "ExamTemplate"("classLevel", "examType");
