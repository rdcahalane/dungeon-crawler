import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { slot = 1, name, data, level, floor, playtime } = body;

  const save = await prisma.saveGame.upsert({
    where: { userId_slot: { userId: session.user.id, slot } },
    create: {
      userId: session.user.id,
      slot,
      name: name ?? "New Game",
      data,
      level: level ?? 1,
      floor: floor ?? 1,
      playtime: playtime ?? 0,
    },
    update: {
      name: name ?? "New Game",
      data,
      level: level ?? 1,
      floor: floor ?? 1,
      playtime: playtime ?? 0,
    },
  });

  return NextResponse.json({ ok: true, id: save.id });
}
