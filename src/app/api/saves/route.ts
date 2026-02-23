import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/** Returns all 5 save slots for the current user (empty slots included as null). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ saves: [] }, { status: 401 });
  }

  const rows = await prisma.saveGame.findMany({
    where: { userId: session.user.id },
    select: { slot: true, name: true, level: true, floor: true, updatedAt: true },
    orderBy: { slot: "asc" },
  });

  // Normalise into a fixed 5-slot array
  const saves: ({ slot: number; name: string; level: number; floor: number; updatedAt: string } | null)[] =
    Array(5).fill(null);

  for (const row of rows) {
    if (row.slot >= 1 && row.slot <= 5) {
      saves[row.slot - 1] = {
        slot: row.slot,
        name: row.name,
        level: row.level,
        floor: row.floor,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
  }

  return NextResponse.json({ saves });
}
