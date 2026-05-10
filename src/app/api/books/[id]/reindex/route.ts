import { NextResponse } from "next/server";

import { reindexBook } from "@/lib/importer";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await reindexBook(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not re-index the book.",
      },
      { status: 500 },
    );
  }
}
