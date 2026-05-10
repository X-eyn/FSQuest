# FSQuest

FSQuest is a local-first web app for Bangla-medium primary teachers who need to create printable question papers without manually typing and formatting Bangla every time.

The product goal is teacher relief first: generate a useful draft, force review, then export only after approval.

## What Works Now

- Upload a Bangla textbook PDF or import the workspace sample.
- OCR indexing uses Tesseract first, so imports do not depend on Gemini availability.
- Optional AI OCR cleanup is bounded, text-only, and non-fatal; a 503 keeps the Tesseract output instead of breaking import.
- Chapters can be reviewed and edited before question generation.
- CT and Final Term blueprints can be edited from the dashboard.
- Paper generation is deterministic by default and does not call Gemini unless explicitly enabled.
- Generated papers become review drafts first.
- Draft DOCX download is blocked until the paper is approved.
- The review screen lets the teacher edit every prompt and teacher answer before export.
- Quality gates block approval when prompts, answers, counts, marks, or OCR artifacts are unsafe.
- Approved papers can be downloaded as DOCX for printing.

## Stack

- Next.js 16
- React 19
- Prisma Client 7
- SQLite
- Tesseract OCR
- Optional Gemini OCR cleanup
- `docx` for Word export

## Commands

```bash
npm install
npm run db:push
npm run db:generate
npm run dev
```

Verification:

```bash
npm run lint
npm run build
npm run quality
```

Open:

- `http://localhost:3000`

## AI Controls

Question generation is deterministic by default.

- Set `FSQUEST_ENABLE_AI_QUESTIONS=true` only if you intentionally want Gemini-backed question generation.
- Set `FSQUEST_OCR_MODE=gemini-image` only if you intentionally want image-level Gemini OCR.
- Set `FSQUEST_OCR_AI_CLEANUP=off` to disable bounded text cleanup after Tesseract.
- Set `FSQUEST_OCR_CLEANUP_PAGE_LIMIT=<number>` to cap cleanup pages.

Default recommended mode:

- Tesseract OCR first
- bounded AI cleanup only for noisy page text
- deterministic question generation
- human review before export

## Safe Workflow

1. Import or upload a textbook.
2. Review chapter quality chips and fix bad chapter text if needed.
3. Tune the exam blueprint if the school format changed.
4. Generate a paper draft.
5. Review every question and teacher answer in the review panel.
6. Save edits as a draft until clean.
7. Click `Approve & Export`.
8. Download the approved DOCX.

## Storage

The app stores local data in:

- `prisma/dev.db`
- `storage/uploads/`
- `storage/raw/`
- `storage/generated/`
- `storage/tessdata/`

## Important Files

- `src/lib/ocr.ts` - Tesseract-first OCR orchestration.
- `scripts/ocr-cleanup-worker.mjs` - bounded, non-fatal text cleanup.
- `src/lib/generator.ts` - deterministic question generation.
- `src/lib/quality.ts` - paper/chapter quality gates.
- `src/app/api/papers/route.ts` - draft paper generation.
- `src/app/api/papers/[id]/route.ts` - save, approve, and rebuild paper drafts.
- `src/app/api/templates/[id]/route.ts` - editable exam blueprint persistence.
- `scripts/quality-check.mjs` - shipping sanity checks.
