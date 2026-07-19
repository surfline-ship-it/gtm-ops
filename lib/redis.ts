import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const STATE_KEY = "gtm-ops:state:v1";

export type ListItem = {
  id: string;
  name: string;
  client: string;
  rows: string;
  source: string;
  notes: string;
  stage: number; // 0 Pulled .. 4 Loaded
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
