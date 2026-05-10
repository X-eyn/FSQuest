import { NextResponse } from "next/server";

import { importBundledSampleBook } from "@/lib/importer";
import { ensureSeedData } from "@/lib/seed";

export const runtime = "nodejs";

export async function POST() {
  try {
    await ensureSeedData();
    const book = await importBundledSampleBook();

    return NextResponse.json({
      book: {
        id: book.id,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not import the bundled sample book.",
      },
      { status: 500 },
    );
  }
}
