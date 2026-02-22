import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const slot = parseInt(url.searchParams.get("slot") ?? "1");

  const save = await prisma.saveGame.findUnique({
    where: { userId_slot: { userId: session.user.id, slot } },
  });

  if (!save) return NextResponse.json({ save: null });

  return NextResponse.json({ save });
}
