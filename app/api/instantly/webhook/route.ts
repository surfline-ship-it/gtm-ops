import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  INSTANTLY_EVENTS_KEY,
  type InstantlyStatusEvent,
} from "@/lib/redis";
import { statusCodeFromEventType } from "@/lib/instantly";

export const dynamic = "force-dynamic";

/** Campaign-level status events we persist; lead/email noise is acknowledged but skipped. */
const CAMPAIGN_STATUS_EVENTS = new Set(["campaign_completed"]);

function extractSecret(req: NextRequest): string | null {
  const q = req.nextUrl.searchParams.get("secret");
  if (q) return q;
  const header = req.headers.get("x-webhook-secret");
  if (header) return header;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return false;
  const got = extractSecret(req);
  return !!got && got === expected;
}

export async function POST(req: NextRequest) {
  if (!process.env.WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = String(body.event_type ?? "");
  const campaignId = String(body.campaign_id ?? "");
  if (!campaignId) {
    return NextResponse.json({ error: "Missing campaign_id" }, { status: 400 });
  }

  const fromType = statusCodeFromEventType(eventType);
  const fromBody =
    typeof body.campaign_status === "number" ? body.campaign_status : null;
  const statusCode = fromType ?? fromBody;
  const isCampaignStatus =
    CAMPAIGN_STATUS_EVENTS.has(eventType) || fromBody != null;

  if (!isCampaignStatus) {
    return NextResponse.json({ ok: true, ignored: true, event_type: eventType });
  }

  const event: InstantlyStatusEvent = {
    campaign_id: campaignId,
    campaign_name: String(body.campaign_name ?? ""),
    event_type: eventType || "campaign_status",
    statusCode,
    timestamp: String(body.timestamp ?? new Date().toISOString()),
    receivedAt: new Date().toISOString(),
    raw: body,
  };

  try {
    const existing =
      (await redis.get<Record<string, InstantlyStatusEvent>>(INSTANTLY_EVENTS_KEY)) ??
      {};
    existing[campaignId] = event;
    await redis.set(INSTANTLY_EVENTS_KEY, existing);
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to store event", detail: String(e) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    campaign_id: campaignId,
    event_type: event.event_type,
    statusCode: event.statusCode,
  });
}
