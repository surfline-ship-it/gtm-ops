// Instantly API v2 client (server-side only — never expose the key to the browser)
// Docs: https://developer.instantly.ai/  (Analytics group)
// GET https://api.instantly.ai/api/v2/campaigns/analytics
//   -> per-campaign array: campaign_name, campaign_id, campaign_status, counts

const BASE = "https://api.instantly.ai/api/v2";

// Instantly campaign_status codes (verify against current docs if these drift)
const STATUS_MAP: Record<number, string> = {
  0: "Draft",
  1: "Active",
  2: "Paused",
  3: "Completed",
  4: "Running Subsequences",
  [-1]: "Deleted",
  [-2]: "Suspended",
};

export type InstantlyCampaign = {
  campaign_id: string;
  campaign_name: string;
  status: string;
  statusCode: number;
  isComplete: boolean;
  leads: number | null;
  contacted: number | null;
  sent: number | null;
  replies: number | null;
  opportunities: number | null;
  bounced: number | null;
  raw: Record<string, unknown>;
};

async function instantlyGet(path: string, params?: Record<string, string>) {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new Error("INSTANTLY_API_KEY is not set");
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
    // analytics don't need to be second-by-second fresh; cache 5 min at the edge
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Instantly ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Pick the first present numeric field among possible names —
// Instantly has used a few naming variants across doc revisions.
function num(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return null;
}

export async function fetchCampaignAnalytics(): Promise<InstantlyCampaign[]> {
  const data = await instantlyGet("/campaigns/analytics");
  const arr: Record<string, unknown>[] = Array.isArray(data) ? data : data?.items ?? [];

  return arr.map((c) => {
    const statusCode = typeof c.campaign_status === "number" ? c.campaign_status : -99;
    return {
      campaign_id: String(c.campaign_id ?? ""),
      campaign_name: String(c.campaign_name ?? "Unnamed"),
      statusCode,
      status: STATUS_MAP[statusCode] ?? `Status ${statusCode}`,
      isComplete: statusCode === 3,
      leads: num(c, "leads_count", "total_leads"),
      contacted: num(c, "contacted_count", "total_contacted"),
      sent: num(c, "emails_sent_count", "sent_count", "total_sent"),
      replies: num(c, "replies_count", "reply_count", "total_replies"),
      opportunities: num(c, "total_opportunities", "opportunities", "total_interested"),
      bounced: num(c, "bounced_count", "total_bounced"),
      raw: c,
    };
  });
}
