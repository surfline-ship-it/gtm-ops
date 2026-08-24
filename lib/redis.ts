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

/** Thesis → Built → Enriched → QC → QC Done → Approved → Loaded */
export const LIST_STAGES = [
  "Thesis",
  "Built",
  "Enriched",
  "QC",
  "QC Done",
  "Approved",
  "Loaded",
] as const;

export const LIST_STAGE_LAST = LIST_STAGES.length - 1; // 6
/** Bump when list stage indices or milestone date backfill rules change. */
export const LIST_PIPELINE_VERSION = 3;

export type ListItem = {
  id: string;
  name: string;
  client: string;
  rows: string;
  source: string;
  notes: string;
  /** 0 Thesis .. 6 Loaded */
  stage: number;
  /** External doc links — paste raw URLs in the form; shown as open buttons on the row. */
  thesisUrl: string;
  buildUrl: string;
  finalListUrl: string;
  /** YYYY-MM-DD — when list work started (thesis ingest). */
  startDate: string;
  /** YYYY-MM-DD — QC completed. Time to QC = qcFinishDate − startDate. */
  qcFinishDate: string;
  /** YYYY-MM-DD — QC approved. Time to approve = approvedDate − qcFinishDate. */
  approvedDate: string;
  /** YYYY-MM-DD — loaded / launched. Time to launch = launchDate − approvedDate. */
  launchDate: string;
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
  /** Schema version for list stage indices (see LIST_PIPELINE_VERSION). */
  listPipelineVersion?: number;
};

export const emptyState: BoardState = {
  lists: [],
  campaigns: [],
  launches: [],
  instantlyClientMap: {},
  listPipelineVersion: LIST_PIPELINE_VERSION,
};

/** Old v1 stages: Pulled, Enriched, QC, Approved, Loaded → v2 indices. */
const V1_STAGE_TO_V2 = [0, 2, 3, 5, 6] as const;

export function normalizeListItem(l: Partial<ListItem> & { id: string }): ListItem {
  return {
    id: l.id,
    name: l.name ?? "",
    client: l.client ?? "",
    rows: l.rows ?? "",
    source: l.source ?? "",
    notes: l.notes ?? "",
    stage: typeof l.stage === "number" ? l.stage : 0,
    thesisUrl: l.thesisUrl ?? "",
    buildUrl: l.buildUrl ?? "",
    finalListUrl: l.finalListUrl ?? "",
    startDate: l.startDate ?? "",
    qcFinishDate: l.qcFinishDate ?? "",
    approvedDate: l.approvedDate ?? "",
    launchDate: l.launchDate ?? "",
    updated: l.updated ?? "",
  };
}

/**
 * If a list is already past a milestone stage but the matching date was never
 * set (advance happened before auto-stamp, or migration jumped stages), fill
 * blanks from `updated` so approve/launch metrics can compute.
 */
export function stampMissingMilestoneDates(l: ListItem): ListItem {
  const fallback = l.updated || new Date().toISOString().slice(0, 10);
  const patch: Partial<ListItem> = {};
  if (l.stage >= 4 && !l.qcFinishDate) patch.qcFinishDate = fallback;
  if (l.stage >= 5 && !l.approvedDate) patch.approvedDate = fallback;
  if (l.stage >= 6 && !l.launchDate) patch.launchDate = fallback;
  return Object.keys(patch).length ? { ...l, ...patch } : l;
}

/** Remap stored board blobs to the current list pipeline; safe to call on every load. */
export function migrateBoardState(raw: BoardState | null | undefined): BoardState {
  const state = { ...emptyState, ...(raw ?? {}) };
  const version = state.listPipelineVersion ?? 1;
  let lists = (state.lists ?? []).map((l) => normalizeListItem(l));

  if (version < 2) {
    lists = lists.map((l) => {
      if (l.stage >= 0 && l.stage <= 4) {
        return { ...l, stage: V1_STAGE_TO_V2[l.stage] };
      }
      return l;
    });
  }

  // Fill blank QC / approved / launch dates when the list is already at those stages.
  lists = lists.map(stampMissingMilestoneDates);

  return {
    ...state,
    lists,
    listPipelineVersion: Math.max(version, LIST_PIPELINE_VERSION),
  };
}
