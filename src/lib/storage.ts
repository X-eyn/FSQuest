import fs from "node:fs/promises";
import path from "node:path";

const APP_ROOT = process.cwd();
export const STORAGE_ROOT = path.join(APP_ROOT, "storage");
export const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");
export const RAW_DIR = path.join(STORAGE_ROOT, "raw");
export const GENERATED_DIR = path.join(STORAGE_ROOT, "generated");
export const TMP_DIR = path.join(STORAGE_ROOT, "tmp");
export const TESSDATA_DIR = path.join(STORAGE_ROOT, "tessdata");

export async function ensureStorageDirs() {
  await Promise.all([
    fs.mkdir(UPLOADS_DIR, { recursive: true }),
    fs.mkdir(RAW_DIR, { recursive: true }),
    fs.mkdir(GENERATED_DIR, { recursive: true }),
    fs.mkdir(TMP_DIR, { recursive: true }),
    fs.mkdir(TESSDATA_DIR, { recursive: true }),
  ]);
}

export async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function toRelativeStoragePath(absolutePath: string) {
  return path.relative(STORAGE_ROOT, absolutePath).replaceAll("\\", "/");
}

export function toAbsoluteStoragePath(relativePath: string) {
  return path.join(STORAGE_ROOT, relativePath);
}

export async function savePdfToStorage(
  bookId: string,
  sourceFileName: string,
  buffer: Buffer,
) {
  await ensureStorageDirs();
  const extension = path.extname(sourceFileName) || ".pdf";
  const absolutePath = path.join(UPLOADS_DIR, `${bookId}${extension}`);
  await fs.writeFile(absolutePath, buffer);
  return {
    absolutePath,
    relativePath: toRelativeStoragePath(absolutePath),
  };
}

export async function copyPdfIntoStorage(
  bookId: string,
  sourceFileName: string,
  sourceAbsolutePath: string,
) {
  const buffer = await fs.readFile(sourceAbsolutePath);
  return savePdfToStorage(bookId, sourceFileName, buffer);
}

export async function writeRawPages(bookId: string, pages: unknown) {
  await ensureStorageDirs();
  const absolutePath = path.join(RAW_DIR, `${bookId}.json`);
  await fs.writeFile(absolutePath, JSON.stringify(pages, null, 2), "utf8");
  return toRelativeStoragePath(absolutePath);
}

export async function writeGeneratedDocx(
  paperId: string,
  fileStem: string,
  buffer: Buffer,
) {
  await ensureStorageDirs();
  const safeStem = fileStem.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
  const absolutePath = path.join(GENERATED_DIR, `${safeStem}-${paperId}.docx`);
  await fs.writeFile(absolutePath, buffer);
  return toRelativeStoragePath(absolutePath);
}
