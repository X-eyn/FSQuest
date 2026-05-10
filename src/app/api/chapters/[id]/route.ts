import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { buildExcerpt } from "@/lib/text";

const chapterSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(10),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = chapterSchema.parse(await request.json());
    await prisma.chapter.update({
      where: { id },
      data: {
        title: payload.title.trim(),
        text: payload.text.trim(),
        excerpt: buildExcerpt(payload.text),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update the chapter.",
      },
      { status: 500 },
    );
  }
}
