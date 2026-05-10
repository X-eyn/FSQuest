import fs from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toAbsoluteStoragePath } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const paper = await prisma.generatedPaper.findUnique({
      where: { id },
    });

    if (!paper) {
      return NextResponse.json({ error: "Paper not found." }, { status: 404 });
    }

    if (paper.reviewStatus !== "APPROVED") {
      return NextResponse.json(
        {
          error: "Review and approve this paper before downloading the final DOCX.",
        },
        { status: 409 },
      );
    }

    const filePath = toAbsoluteStoragePath(paper.docxPath);
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readFile(filePath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return NextResponse.json(
          {
            error:
              "The approved DOCX file is missing. Save or approve the paper again to rebuild it.",
          },
          { status: 410 },
        );
      }

      throw error;
    }

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${paper.title.replace(/[^\w.-]+/g, "-")}.docx"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not download the DOCX file.",
      },
      { status: 500 },
    );
  }
}
