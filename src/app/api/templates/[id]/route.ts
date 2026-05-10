import { NextResponse } from "next/server";
import { z } from "zod";

import { examStructureSchema } from "@/lib/exam";
import { prisma } from "@/lib/prisma";
import { getSectionMarks } from "@/lib/utils";

const templatePatchSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  totalMarks: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
  instructions: z.string().trim().nullable().optional(),
  structure: examStructureSchema,
});

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = templatePatchSchema.parse(await request.json());
    const structureMarks = payload.structure.reduce(
      (total, section) =>
        total +
        Array.from({ length: section.itemCount }).reduce<number>(
          (sectionTotal, _item, index) => sectionTotal + getSectionMarks(section, index),
          0,
        ),
      0,
    );

    if (Math.abs(structureMarks - payload.totalMarks) > 0.001) {
      return NextResponse.json(
        {
          error: `Blueprint marks add up to ${structureMarks}, not ${payload.totalMarks}.`,
        },
        { status: 422 },
      );
    }

    await prisma.examTemplate.update({
      where: { id },
      data: {
        displayName: payload.displayName,
        totalMarks: payload.totalMarks,
        durationMinutes: payload.durationMinutes,
        instructions: payload.instructions?.trim() || null,
        structureJson: JSON.stringify(payload.structure),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update the exam blueprint.",
      },
      { status: 500 },
    );
  }
}
