import { NextResponse } from "next/server";
import {
  applyWebhookStatuses,
  fetchCampaignAnalytics,
} from "@/lib/instantly";
import {
  redis,
  INSTANTLY_EVENTS_KEY,
  type InstantlyStatusEvent,
} from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [campaigns, events] = await Promise.all([
      fetchCampaignAnalytics(),
      redis
        .get<Record<string, InstantlyStatusEvent>>(INSTANTLY_EVENTS_KEY)
        .catch(() => null),
    ]);

    const merged = events ? applyWebhookStatuses(campaigns, events) : campaigns;

    return NextResponse.json({
      syncedAt: new Date().toISOString(),
      campaigns: merged,
      webhookOverrides: events ? Object.keys(events).length : 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Instantly sync failed", detail: String(e) },
      { status: 502 }
    );
  }
}
