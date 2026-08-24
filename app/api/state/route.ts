import { NextRequest, NextResponse } from "next/server";
import { redis, STATE_KEY, emptyState, BoardState, migrateBoardState } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await redis.get<BoardState>(STATE_KEY);
    const migrated = migrateBoardState(state ?? emptyState);
    // Persist stage remaps once so Redis stays on the current pipeline version.
    if ((state?.listPipelineVersion ?? 1) < 2) {
      await redis.set(STATE_KEY, migrated);
    }
    return NextResponse.json(migrated);
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
    const migrated = migrateBoardState(body);
    await redis.set(STATE_KEY, migrated);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to save state", detail: String(e) },
      { status: 500 }
    );
  }
}
