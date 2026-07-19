import { NextResponse } from "next/server";
import { fetchCampaignAnalytics } from "@/lib/instantly";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const campaigns = await fetchCampaignAnalytics();
    return NextResponse.json({
      syncedAt: new Date().toISOString(),
      campaigns,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Instantly sync failed", detail: String(e) },
      { status: 502 }
    );
  }
}
