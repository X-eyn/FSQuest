import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ImportStatus } from "@prisma/client";

import { ocrPdfToPages } from "@/lib/ocr";
import { prisma } from "@/lib/prisma";
import { getBundledSamplePdfPath } from "@/lib/sample";
import {
  copyPdfIntoStorage,
  savePdfToStorage,
  toAbsoluteStoragePath,
  writeRawPages,
} from "@/lib/storage";
import { segmentPagesIntoChapters } from "@/lib/text";

type ImportBookInput = {
  title: string;
  classLevel: string;
  subject: string;
  fileName: string;
  buffer: Buffer;
};

export async function importBookFromBuffer(input: ImportBookInput) {
  const bookId = randomUUID();
  const storageResult = await savePdfToStorage(bookId, input.fileName, input.buffer);

  await prisma.book.create({
    data: {
      id: bookId,
      title: input.title,
      classLevel: input.classLevel,
      subject: input.subject,
      pdfFileName: input.fileName,
      pdfStoragePath: storageResult.relativePath,
      importStatus: ImportStatus.INDEXING,
    },
  });

  try {
    const ocrResult = await ocrPdfToPages(storageResult.absolutePath);
    const chapterResult = segmentPagesIntoChapters(ocrResult.pages);
    const rawTextPath = await writeRawPages(bookId, ocrResult.pages);

    await prisma.$transaction([
      prisma.chapter.deleteMany({
        where: {
          bookId,
        },
      }),
      prisma.book.update({
        where: { id: bookId },
        data: {
          rawTextPath,
          pageCount: ocrResult.pageCount,
          extractionMethod: ocrResult.extractionMethod,
          importStatus: chapterResult.usedFallback
            ? ImportStatus.NEEDS_REVIEW
            : ImportStatus.INDEXED,
          notes: chapterResult.usedFallback
            ? "OCR finished, but no clear chapter headings were found. Please review the chapter chunks."
            : "OCR finished successfully.",
          indexedAt: new Date(),
        },
      }),
      prisma.chapter.createMany({
        data: chapterResult.chapters.map((chapter) => ({
          bookId,
          title: chapter.title,
          sortOrder: chapter.sortOrder,
          startPage: chapter.startPage,
          endPage: chapter.endPage,
          excerpt: chapter.excerpt,
          text: chapter.text,
        })),
      }),
    ]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown OCR import failure.";
    await prisma.book.update({
      where: { id: bookId },
      data: {
        importStatus: ImportStatus.FAILED,
        notes: message,
      },
    });
    throw error;
  }

  return prisma.book.findUniqueOrThrow({
    where: { id: bookId },
    include: {
      chapters: {
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });
}

export async function importBundledSampleBook() {
  const sourcePath = getBundledSamplePdfPath();
  const stat = await fs.stat(sourcePath).catch(() => null);

  if (!stat) {
    throw new Error("Bundled sample PDF was not found in the workspace root.");
  }

  const bookId = randomUUID();
  const fileName = path.basename(sourcePath);
  const storageResult = await copyPdfIntoStorage(bookId, fileName, sourcePath);

  await prisma.book.create({
    data: {
      id: bookId,
      title: "Class 3 Bangla Combine",
      classLevel: "Three",
      subject: "Bangla Literature",
      pdfFileName: fileName,
      pdfStoragePath: storageResult.relativePath,
      importStatus: ImportStatus.INDEXING,
    },
  });

  try {
    const ocrResult = await ocrPdfToPages(storageResult.absolutePath);
    const chapterResult = segmentPagesIntoChapters(ocrResult.pages);
    const rawTextPath = await writeRawPages(bookId, ocrResult.pages);

    await prisma.$transaction([
      prisma.book.update({
        where: { id: bookId },
        data: {
          rawTextPath,
          pageCount: ocrResult.pageCount,
          extractionMethod: ocrResult.extractionMethod,
          importStatus: chapterResult.usedFallback
            ? ImportStatus.NEEDS_REVIEW
            : ImportStatus.INDEXED,
          notes: chapterResult.usedFallback
            ? "Sample book imported and OCR finished, but chapter boundaries need review."
            : "Sample book imported successfully.",
          indexedAt: new Date(),
        },
      }),
      prisma.chapter.createMany({
        data: chapterResult.chapters.map((chapter) => ({
          bookId,
          title: chapter.title,
          sortOrder: chapter.sortOrder,
          startPage: chapter.startPage,
          endPage: chapter.endPage,
          excerpt: chapter.excerpt,
          text: chapter.text,
        })),
      }),
    ]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown OCR import failure.";
    await prisma.book.update({
      where: { id: bookId },
      data: {
        importStatus: ImportStatus.FAILED,
        notes: message,
      },
    });
    throw error;
  }

  return prisma.book.findUniqueOrThrow({
    where: { id: bookId },
    include: {
      chapters: {
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });
}

export async function reindexBook(bookId: string) {
  const book = await prisma.book.findUniqueOrThrow({
    where: { id: bookId },
  });

  await prisma.book.update({
    where: { id: bookId },
    data: {
      importStatus: ImportStatus.INDEXING,
      notes: "Re-indexing in progress...",
    },
  });

  try {
    const ocrResult = await ocrPdfToPages(toAbsoluteStoragePath(book.pdfStoragePath));
    const chapterResult = segmentPagesIntoChapters(ocrResult.pages);
    const rawTextPath = await writeRawPages(bookId, ocrResult.pages);

    await prisma.$transaction([
      prisma.chapter.deleteMany({
        where: {
          bookId,
        },
      }),
      prisma.book.update({
        where: { id: bookId },
        data: {
          rawTextPath,
          pageCount: ocrResult.pageCount,
          extractionMethod: ocrResult.extractionMethod,
          importStatus: chapterResult.usedFallback
            ? ImportStatus.NEEDS_REVIEW
            : ImportStatus.INDEXED,
          notes: chapterResult.usedFallback
            ? "Re-index finished, but chapter boundaries still need manual review."
            : "Re-index completed successfully.",
          indexedAt: new Date(),
        },
      }),
      prisma.chapter.createMany({
        data: chapterResult.chapters.map((chapter) => ({
          bookId,
          title: chapter.title,
          sortOrder: chapter.sortOrder,
          startPage: chapter.startPage,
          endPage: chapter.endPage,
          excerpt: chapter.excerpt,
          text: chapter.text,
        })),
      }),
    ]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown OCR re-index failure.";
    await prisma.book.update({
      where: { id: bookId },
      data: {
        importStatus: ImportStatus.FAILED,
        notes: message,
      },
    });
    throw error;
  }

  return prisma.book.findUniqueOrThrow({
    where: { id: bookId },
    include: {
      chapters: {
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });
}
