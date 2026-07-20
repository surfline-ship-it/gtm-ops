import { Redis } from "@upstash/redis";

// Vercel Marketplace Upstash often injects KV_REST_API_* instead of UPSTASH_REDIS_REST_*.
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN!,
});

export const STATE_KEY = "gtm-ops:state:v1";
/** Latest Instantly campaign-status webhook event, keyed by campaign_id. */
export const INSTANTLY_EVENTS_KEY = "gtm-ops:instantly:events";

export type InstantlyStatusEvent = {
  campaign_id: string;
  campaign_name: string;
  event_type: string;
  /** Instantly campaign_status when present; 3 for campaign_completed. */
  statusCode: number | null;
  timestamp: string;
  receivedAt: string;
  raw: Record<string, unknown>;
};

export type ListItem = {
  id: string;
  name: string;
  client: string;
  rows: string;
  source: string;
  notes: string;
  stage: number; // 0 Pulled .. 4 Loaded
  /** External doc links — paste raw URLs in the form; shown as open buttons on the row. */
  thesisUrl: string;
  buildUrl: string;
  finalListUrl: string;
  updated: string;
};

export type ManualCampaign = {
  id: string;
  name: string;
  client: string;
  platform: string;
  status: string;
  sent: string;
  replies: string;
  positive: string;
  meetings: string;
  notes: string;
  updated: string;
};

export type Launch = {
  id: string;
  name: string;
  client: string;
  targetDate: string;
  notes: string;
  thesisUrl: string;
  checklist: Record<string, boolean>;
  updated: string;
};

export type BoardState = {
  lists: ListItem[];
  campaigns: ManualCampaign[]; // manual / non-Instantly campaigns
  launches: Launch[];
  // client labels keyed by Instantly campaign_id, e.g. { "abc-123": "PieEye" }
  instantlyClientMap: Record<string, string>;
};

export const emptyState: BoardState = {
  lists: [],
  campaigns: [],
  launches: [],
  instantlyClientMap: {},
};
