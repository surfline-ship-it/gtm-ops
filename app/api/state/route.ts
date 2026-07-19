import { NextRequest, NextResponse } from "next/server";
import { redis, STATE_KEY, emptyState, BoardState } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await redis.get<BoardState>(STATE_KEY);
    return NextResponse.json(state ?? emptyState);
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to read state", detail: String(e) },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as BoardState;
    // minimal shape guard
    if (!body || !Array.isArray(body.lists) || !Array.isArray(body.launches)) {
      return NextResponse.json({ error: "Bad state shape" }, { status: 400 });
    }
    await redis.set(STATE_KEY, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to save state", detail: String(e) },
      { status: 500 }
    );
  }
}
