import { NextResponse } from "next/server";

import { importBookFromBuffer } from "@/lib/importer";
import { ensureSeedData } from "@/lib/seed";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await ensureSeedData();
    const formData = await request.formData();
    const title = String(formData.get("title") ?? "Bangla Literature");
    const classLevel = String(formData.get("classLevel") ?? "Three");
    const subject = String(formData.get("subject") ?? "Bangla Literature");
    const pdf = formData.get("pdf");

    if (!(pdf instanceof File)) {
      return NextResponse.json(
        { error: "Please attach a PDF textbook file." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await pdf.arrayBuffer());
    const book = await importBookFromBuffer({
      title,
      classLevel,
      subject,
      fileName: pdf.name,
      buffer,
    });

    return NextResponse.json({
      book: {
        id: book.id,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import the book.",
      },
      { status: 500 },
    );
  }
}
