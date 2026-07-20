"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardState, ListItem, ManualCampaign, Launch } from "@/lib/redis";

/* ============================================================
   GTM OPS — Lists pipeline · Campaigns (Instantly-synced + manual)
   · ODP launch pre-flight
   ============================================================ */

const LIST_STAGES = ["Pulled", "Enriched", "QC", "Approved", "Loaded"];
const CAMPAIGN_STATUSES = ["Draft", "Warming", "Live", "Paused", "Done"];
const PLATFORMS = ["Smartlead", "HubSpot", "Other"];

const CHECKLIST_ITEMS = [
  { key: "domains", label: "Domains purchased" },
  { key: "dns", label: "DNS set (SPF/DKIM/DMARC)" },
  { key: "warmup", label: "Mailboxes warmed" },
  { key: "copy", label: "Copy approved" },
  { key: "qc", label: "List QC'd" },
  { key: "loaded", label: "List loaded" },
  { key: "sequence", label: "Sequence built" },
];

type InstantlyCampaign = {
  campaign_id: string;
  campaign_name: string;
  status: string;
  isComplete: boolean;
  leads: number | null;
  contacted: number | null;
  sent: number | null;
  replies: number | null;
  opportunities: number | null;
};

const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const today = () => new Date().toISOString().slice(0, 10);

const emptyState: BoardState = {
  lists: [],
  campaigns: [],
  launches: [],
  instantlyClientMap: {},
};

const stageColor = (i: number) =>
  i >= 4 ? "var(--teal)" : i >= 2 ? "var(--amber)" : "var(--blue)";

const statusColor = (s: string) =>
  ({
    Draft: "var(--faint)",
    Warming: "var(--amber)",
    Live: "var(--teal)",
    Active: "var(--teal)",
    Paused: "var(--red)",
    Done: "var(--dim)",
    Completed: "var(--teal)",
  } as Record<string, string>)[s] ?? "var(--dim)";

/* ---------- shared UI bits ---------- */

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 3,
        fontSize: 11,
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        background: "transparent",
        whiteSpace: "nowrap",
        opacity: 0.95,
      }}
    >
      {children}
    </span>
  );
}

function Field({
  label,
  children,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flexGrow: grow ? 1 : 0,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--faint)",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--ink)",
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  minWidth: 0,
};

const btnTones: Record<string, React.CSSProperties> = {
  ghost: { background: "transparent", color: "var(--dim)", border: "1px solid var(--line)" },
  accent: { background: "var(--teal)", color: "#0c1418", border: "1px solid var(--teal)" },
  danger: { background: "transparent", color: "var(--red)", border: "1px solid var(--red)" },
  link: { background: "transparent", color: "var(--blue)", border: "1px solid var(--blue)" },
};

function Btn({
  onClick,
  children,
  tone = "ghost",
  small,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "ghost" | "accent" | "danger";
  small?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        ...btnTones[tone],
        borderRadius: 4,
        padding: small ? "3px 9px" : "7px 14px",
        fontSize: small ? 11 : 12.5,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/** External doc link styled like a button; omitted when url is empty. */
function LinkOut({ href, children }: { href?: string; children: React.ReactNode }) {
  const url = (href || "").trim();
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        ...btnTones.link,
        borderRadius: 4,
        padding: "3px 9px",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {children} ↗
    </a>
  );
}

const rowCard: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "14px 16px",
  marginBottom: 10,
};

const formBox: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "flex-start",
  background: "var(--panel-up)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: 16,
  marginBottom: 16,
};

function Empty({ msg }: { msg: string }) {
  return (
    <div
      style={{
        color: "var(--faint)",
        fontSize: 13,
        padding: "28px 0",
        textAlign: "center",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {msg}
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ color: highlight ? "var(--teal)" : "var(--ink)", fontWeight: 600 }}>
        {value ?? "—"}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--faint)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 5,
        padding: "8px 14px",
      }}
    >
      <span
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 24,
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--faint)",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* ============================================================ */

export default function Page() {
  const [state, setState] = useState<BoardState | null>(null);
  const [tab, setTab] = useState<"lists" | "campaigns" | "launches">("lists");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState("");

  const [instantly, setInstantly] = useState<InstantlyCampaign[] | null>(null);
  const [instantlyError, setInstantlyError] = useState("");
  const [syncedAt, setSyncedAt] = useState("");
  const [syncing, setSyncing] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* load board state */
  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((s) => setState({ ...emptyState, ...s }))
      .catch(() => setState(emptyState));
  }, []);

  /* Instantly sync */
  const sync = useCallback(async () => {
    setSyncing(true);
    setInstantlyError("");
    try {
      const r = await fetch("/api/instantly/sync");
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "sync failed");
      setInstantly(data.campaigns);
      setSyncedAt(new Date(data.syncedAt).toLocaleTimeString());
    } catch (e) {
      setInstantlyError(String(e).slice(0, 200));
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  /* debounced persist */
  const persist = useCallback((next: BoardState) => {
    setState(next);
    setSaveStatus("saving…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!r.ok) throw new Error();
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 1200);
      } catch {
        setSaveStatus("save failed — check connection");
      }
    }, 500);
  }, []);

  if (!state) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--dim)",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
        }}
      >
        loading board…
      </div>
    );
  }

  const mutate = <K extends "lists" | "campaigns" | "launches">(
    section: K,
    fn: (arr: BoardState[K]) => BoardState[K]
  ) => persist({ ...state, [section]: fn(state[section]) });

  const removeItem = (section: "lists" | "campaigns" | "launches", id: string) => {
    if (!window.confirm("Delete this entry?")) return;
    mutate(section, (arr) => (arr as { id: string }[]).filter((x) => x.id !== id) as never);
  };

  const setClientLabel = (campaignId: string, label: string) =>
    persist({
      ...state,
      instantlyClientMap: { ...state.instantlyClientMap, [campaignId]: label },
    });

  const liveCount =
    (instantly?.filter((c) => c.status === "Active").length ?? 0) +
    state.campaigns.filter((c) => c.status === "Live").length;
  const completedCount = instantly?.filter((c) => c.isComplete).length ?? 0;
  const listsInFlight = state.lists.filter((l) => l.stage < 4).length;
  const launchesReady = state.launches.filter((l) =>
    CHECKLIST_ITEMS.every((i) => l.checklist[i.key])
  ).length;

  const tabs = [
    { id: "lists" as const, label: "Lists", count: state.lists.length },
    {
      id: "campaigns" as const,
      label: "Campaigns",
      count: (instantly?.length ?? 0) + state.campaigns.length,
    },
    { id: "launches" as const, label: "ODP Launches", count: state.launches.length },
  ];

  return (
    <div>
      {/* header */}
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          flexWrap: "wrap",
          padding: "20px 24px 0",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: "0.04em",
          }}
        >
          GTM OPS
        </h1>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: "var(--faint)",
            letterSpacing: "0.1em",
          }}
        >
          SURFLINE
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: saveStatus.includes("failed") ? "var(--red)" : "var(--teal)",
          }}
        >
          {saveStatus}
        </span>
      </header>

      {/* status strip */}
      <div style={{ display: "flex", gap: 10, padding: "14px 24px", flexWrap: "wrap" }}>
        <Stat label="lists in flight" value={listsInFlight} color="var(--blue)" />
        <Stat label="live campaigns" value={liveCount} color="var(--teal)" />
        <Stat label="completed (instantly)" value={completedCount} color="var(--dim)" />
        <Stat label="launches ready" value={launchesReady} color="var(--amber)" />
      </div>

      {/* tabs */}
      <nav
        style={{
          display: "flex",
          gap: 4,
          padding: "0 24px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setShowForm(false);
              setEditId(null);
            }}
            style={{
              background: "transparent",
              border: "none",
              borderBottom:
                tab === t.id ? "2px solid var(--teal)" : "2px solid transparent",
              color: tab === t.id ? "var(--ink)" : "var(--dim)",
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'Barlow Condensed', sans-serif",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {t.label}{" "}
            <span
              style={{
                color: "var(--faint)",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
              }}
            >
              {t.count}
            </span>
          </button>
        ))}
        <div style={{ marginLeft: "auto", alignSelf: "center", paddingBottom: 6 }}>
          <Btn
            tone="accent"
            onClick={() => {
              setShowForm((v) => !v);
              setEditId(null);
            }}
          >
            {showForm ? "close" : "+ add"}
          </Btn>
        </div>
      </nav>

      <main style={{ padding: "18px 24px 32px" }}>
        {tab === "lists" && (
          <ListsTab
            items={state.lists}
            mutate={(fn) => mutate("lists", fn)}
            remove={(id) => removeItem("lists", id)}
            showForm={showForm}
            setShowForm={setShowForm}
            editId={editId}
            setEditId={setEditId}
          />
        )}
        {tab === "campaigns" && (
          <CampaignsTab
            instantly={instantly}
            instantlyError={instantlyError}
            syncedAt={syncedAt}
            syncing={syncing}
            onSync={sync}
            clientMap={state.instantlyClientMap}
            setClientLabel={setClientLabel}
            manual={state.campaigns}
            mutate={(fn) => mutate("campaigns", fn)}
            remove={(id) => removeItem("campaigns", id)}
            showForm={showForm}
            setShowForm={setShowForm}
            editId={editId}
            setEditId={setEditId}
          />
        )}
        {tab === "launches" && (
          <LaunchesTab
            items={state.launches}
            mutate={(fn) => mutate("launches", fn)}
            remove={(id) => removeItem("launches", id)}
            showForm={showForm}
            setShowForm={setShowForm}
            editId={editId}
            setEditId={setEditId}
          />
        )}
      </main>
    </div>
  );
}

/* ============================== LISTS ============================== */

function ListsTab({
  items,
  mutate,
  remove,
  showForm,
  setShowForm,
  editId,
  setEditId,
}: {
  items: ListItem[];
  mutate: (fn: (arr: ListItem[]) => ListItem[]) => void;
  remove: (id: string) => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editId: string | null;
  setEditId: (v: string | null) => void;
}) {
  const blank = {
    name: "",
    client: "",
    rows: "",
    source: "Clay",
    notes: "",
    thesisUrl: "",
    buildUrl: "",
    finalListUrl: "",
  };
  const [draft, setDraft] = useState(blank);
  const editing = items.find((x) => x.id === editId);

  useEffect(() => {
    if (editing)
      setDraft({
        name: editing.name,
        client: editing.client,
        rows: editing.rows,
        source: editing.source,
        notes: editing.notes,
        thesisUrl: editing.thesisUrl || "",
        buildUrl: editing.buildUrl || "",
        finalListUrl: editing.finalListUrl || "",
      });
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!draft.name.trim()) return;
    if (editing) {
      mutate((arr) =>
        arr.map((x) => (x.id === editId ? { ...x, ...draft, updated: today() } : x))
      );
      setEditId(null);
    } else {
      mutate((arr) => [{ id: uid(), ...draft, stage: 0, updated: today() }, ...arr]);
    }
    setDraft(blank);
    setShowForm(false);
  };

  return (
    <div>
      {(showForm || editing) && (
        <div style={formBox}>
          <Field label="List name" grow>
            <input
              style={inputStyle}
              value={draft.name}
              placeholder="e.g. Industrial Automation — Southeast v2"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Client / search">
            <input
              style={inputStyle}
              value={draft.client}
              onChange={(e) => setDraft({ ...draft, client: e.target.value })}
            />
          </Field>
          <Field label="Rows">
            <input
              style={{ ...inputStyle, width: 90 }}
              value={draft.rows}
              onChange={(e) => setDraft({ ...draft, rows: e.target.value })}
            />
          </Field>
          <Field label="Source">
            <select
              style={inputStyle}
              value={draft.source}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            >
              {["Clay", "Apollo", "Manual", "Client-provided", "Other"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes" grow>
            <input
              style={inputStyle}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>
          <Field label="Search Thesis URL" grow>
            <input
              style={inputStyle}
              value={draft.thesisUrl}
              placeholder="https://…"
              onChange={(e) => setDraft({ ...draft, thesisUrl: e.target.value })}
            />
          </Field>
          <Field label="Build URL" grow>
            <input
              style={inputStyle}
              value={draft.buildUrl}
              placeholder="https://…"
              onChange={(e) => setDraft({ ...draft, buildUrl: e.target.value })}
            />
          </Field>
          <Field label="Final List URL" grow>
            <input
              style={inputStyle}
              value={draft.finalListUrl}
              placeholder="https://…"
              onChange={(e) => setDraft({ ...draft, finalListUrl: e.target.value })}
            />
          </Field>
          <div style={{ alignSelf: "flex-end" }}>
            <Btn tone="accent" onClick={submit}>
              {editing ? "save" : "add list"}
            </Btn>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <Empty msg="No lists yet. Add the first pull to start tracking it through QC." />
      )}

      {items.map((l) => (
        <div key={l.id} style={rowCard}>
          <div style={{ flexGrow: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{l.name}</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--dim)",
                marginTop: 2,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {l.client || "—"} · {l.rows ? `${l.rows} rows` : "rows n/a"} · {l.source} ·
              upd {l.updated}
            </div>
            {l.notes && (
              <div style={{ fontSize: 12.5, color: "var(--dim)", marginTop: 4 }}>
                {l.notes}
              </div>
            )}
            {(l.thesisUrl || l.buildUrl || l.finalListUrl) && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <LinkOut href={l.thesisUrl}>Search Thesis</LinkOut>
                <LinkOut href={l.buildUrl}>Build</LinkOut>
                <LinkOut href={l.finalListUrl}>Final List</LinkOut>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {LIST_STAGES.map((s, i) => (
              <div key={s} title={s} style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 34,
                    height: 6,
                    borderRadius: 2,
                    background: i <= l.stage ? stageColor(l.stage) : "var(--line)",
                  }}
                />
                <div
                  style={{
                    fontSize: 8.5,
                    marginTop: 3,
                    color: i <= l.stage ? "var(--dim)" : "var(--faint)",
                    fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: "0.04em",
                  }}
                >
                  {s}
                </div>
              </div>
            ))}
          </div>

          <Chip color={stageColor(l.stage)}>{LIST_STAGES[l.stage]}</Chip>

          <div style={{ display: "flex", gap: 6 }}>
            {l.stage > 0 && (
              <Btn
                small
                title="Move back"
                onClick={() =>
                  mutate((arr) =>
                    arr.map((x) =>
                      x.id === l.id ? { ...x, stage: x.stage - 1, updated: today() } : x
                    )
                  )
                }
              >
                ◂
              </Btn>
            )}
            {l.stage < 4 && (
              <Btn
                small
                tone="accent"
                title="Advance stage"
                onClick={() =>
                  mutate((arr) =>
                    arr.map((x) =>
                      x.id === l.id ? { ...x, stage: x.stage + 1, updated: today() } : x
                    )
                  )
                }
              >
                advance ▸
              </Btn>
            )}
            <Btn small onClick={() => setEditId(l.id)}>
              edit
            </Btn>
            <Btn small tone="danger" onClick={() => remove(l.id)}>
              ✕
            </Btn>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================== CAMPAIGNS ============================== */

function CampaignsTab({
  instantly,
  instantlyError,
  syncedAt,
  syncing,
  onSync,
  clientMap,
  setClientLabel,
  manual,
  mutate,
  remove,
  showForm,
  setShowForm,
  editId,
  setEditId,
}: {
  instantly: InstantlyCampaign[] | null;
  instantlyError: string;
  syncedAt: string;
  syncing: boolean;
  onSync: () => void;
  clientMap: Record<string, string>;
  setClientLabel: (id: string, label: string) => void;
  manual: ManualCampaign[];
  mutate: (fn: (arr: ManualCampaign[]) => ManualCampaign[]) => void;
  remove: (id: string) => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editId: string | null;
  setEditId: (v: string | null) => void;
}) {
  const blank = {
    name: "",
    client: "",
    platform: "Smartlead",
    status: "Draft",
    sent: "",
    replies: "",
    positive: "",
    meetings: "",
    notes: "",
  };
  const [draft, setDraft] = useState(blank);
  const editing = manual.find((x) => x.id === editId);

  useEffect(() => {
    if (editing) setDraft({ ...blank, ...editing });
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!draft.name.trim()) return;
    if (editing) {
      mutate((arr) =>
        arr.map((x) => (x.id === editId ? { ...x, ...draft, updated: today() } : x))
      );
      setEditId(null);
    } else {
      mutate((arr) => [{ id: uid(), ...draft, updated: today() }, ...arr]);
    }
    setDraft(blank);
    setShowForm(false);
  };

  const rate = (sent: number | null, replies: number | null) =>
    sent && replies != null ? ((replies / sent) * 100).toFixed(1) + "%" : "—";

  const sectionHead: React.CSSProperties = {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--dim)",
    margin: "18px 0 10px",
    display: "flex",
    alignItems: "center",
    gap: 12,
  };

  return (
    <div>
      {(showForm || editing) && (
        <div style={formBox}>
          <Field label="Campaign" grow>
            <input
              style={inputStyle}
              value={draft.name}
              placeholder="Non-Instantly campaign (Smartlead, HubSpot…)"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Client">
            <input
              style={inputStyle}
              value={draft.client}
              onChange={(e) => setDraft({ ...draft, client: e.target.value })}
            />
          </Field>
          <Field label="Platform">
            <select
              style={inputStyle}
              value={draft.platform}
              onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
            >
              {PLATFORMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              style={inputStyle}
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              {CAMPAIGN_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          {(["sent", "replies", "positive", "meetings"] as const).map((k) => (
            <Field key={k} label={k}>
              <input
                style={{ ...inputStyle, width: 78 }}
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="Notes" grow>
            <input
              style={inputStyle}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>
          <div style={{ alignSelf: "flex-end" }}>
            <Btn tone="accent" onClick={submit}>
              {editing ? "save" : "add campaign"}
            </Btn>
          </div>
        </div>
      )}

      {/* --- Instantly synced --- */}
      <div style={sectionHead}>
        Instantly (synced)
        <Btn small onClick={onSync}>
          {syncing ? "syncing…" : "↻ sync"}
        </Btn>
        {syncedAt && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "var(--faint)",
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            last {syncedAt}
          </span>
        )}
      </div>

      {instantlyError && (
        <div
          style={{
            color: "var(--red)",
            fontSize: 12.5,
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 10,
          }}
        >
          Instantly sync error: {instantlyError} — check INSTANTLY_API_KEY in your env
          vars, then sync again.
        </div>
      )}

      {instantly && instantly.length === 0 && (
        <Empty msg="Connected, but no campaigns returned from Instantly." />
      )}
      {!instantly && !instantlyError && <Empty msg="Syncing Instantly campaigns…" />}

      {instantly?.map((c) => (
        <div
          key={c.campaign_id}
          style={{
            ...rowCard,
            borderLeft: c.isComplete
              ? "3px solid var(--teal)"
              : "3px solid var(--line)",
          }}
        >
          <div style={{ flexGrow: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.campaign_name}</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "var(--faint)",
                  fontFamily: "'IBM Plex Mono', monospace",
                  letterSpacing: "0.08em",
                }}
              >
                CLIENT
              </span>
              <input
                style={{ ...inputStyle, padding: "3px 8px", fontSize: 12, width: 160 }}
                value={clientMap[c.campaign_id] ?? ""}
                placeholder="tag client…"
                onChange={(e) => setClientLabel(c.campaign_id, e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 18,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
            }}
          >
            <Metric label="leads" value={c.leads ?? "—"} />
            <Metric label="contacted" value={c.contacted ?? "—"} />
            <Metric label="sent" value={c.sent ?? "—"} />
            <Metric label="replies" value={c.replies ?? "—"} />
            <Metric label="rate" value={rate(c.sent, c.replies)} highlight />
            <Metric label="opps" value={c.opportunities ?? "—"} highlight />
          </div>

          <Chip color={statusColor(c.status)}>
            {c.isComplete ? "✓ COMPLETED" : c.status}
          </Chip>
        </div>
      ))}

      {/* --- manual --- */}
      <div style={sectionHead}>Manual / other platforms</div>
      {manual.length === 0 && (
        <Empty msg="No manual campaigns. Use + add for Smartlead or HubSpot sends." />
      )}
      {manual.map((c) => (
        <div key={c.id} style={rowCard}>
          <div style={{ flexGrow: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.name}</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--dim)",
                marginTop: 2,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {c.client || "—"} · {c.platform} · upd {c.updated}
            </div>
            {c.notes && (
              <div style={{ fontSize: 12.5, color: "var(--dim)", marginTop: 4 }}>
                {c.notes}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 18,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
            }}
          >
            <Metric label="sent" value={c.sent || "—"} />
            <Metric label="replies" value={c.replies || "—"} />
            <Metric
              label="rate"
              value={rate(parseInt(c.sent, 10) || null, parseInt(c.replies, 10) || null)}
              highlight
            />
            <Metric label="positive" value={c.positive || "—"} />
            <Metric label="mtgs" value={c.meetings || "—"} highlight />
          </div>

          <Chip color={statusColor(c.status)}>{c.status}</Chip>

          <div style={{ display: "flex", gap: 6 }}>
            <Btn small onClick={() => setEditId(c.id)}>
              edit
            </Btn>
            <Btn small tone="danger" onClick={() => remove(c.id)}>
              ✕
            </Btn>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================== LAUNCHES ============================== */

function LaunchesTab({
  items,
  mutate,
  remove,
  showForm,
  setShowForm,
  editId,
  setEditId,
}: {
  items: Launch[];
  mutate: (fn: (arr: Launch[]) => Launch[]) => void;
  remove: (id: string) => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  editId: string | null;
  setEditId: (v: string | null) => void;
}) {
  const blank = { name: "", client: "", targetDate: "", notes: "", thesisUrl: "" };
  const [draft, setDraft] = useState(blank);
  const editing = items.find((x) => x.id === editId);

  useEffect(() => {
    if (editing)
      setDraft({
        name: editing.name,
        client: editing.client,
        targetDate: editing.targetDate,
        notes: editing.notes,
        thesisUrl: editing.thesisUrl || "",
      });
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!draft.name.trim()) return;
    if (editing) {
      mutate((arr) =>
        arr.map((x) => (x.id === editId ? { ...x, ...draft, updated: today() } : x))
      );
      setEditId(null);
    } else {
      const checklist: Record<string, boolean> = {};
      CHECKLIST_ITEMS.forEach((i) => (checklist[i.key] = false));
      mutate((arr) => [{ id: uid(), ...draft, checklist, updated: today() }, ...arr]);
    }
    setDraft(blank);
    setShowForm(false);
  };

  const toggle = (id: string, key: string) =>
    mutate((arr) =>
      arr.map((l) =>
        l.id === id
          ? {
              ...l,
              checklist: { ...l.checklist, [key]: !l.checklist[key] },
              updated: today(),
            }
          : l
      )
    );

  return (
    <div>
      {(showForm || editing) && (
        <div style={formBox}>
          <Field label="Launch name" grow>
            <input
              style={inputStyle}
              value={draft.name}
              placeholder="e.g. Refrigeration search — wave 2"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Client / search">
            <input
              style={inputStyle}
              value={draft.client}
              onChange={(e) => setDraft({ ...draft, client: e.target.value })}
            />
          </Field>
          <Field label="Target date">
            <input
              type="date"
              style={inputStyle}
              value={draft.targetDate}
              onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })}
            />
          </Field>
          <Field label="Notes" grow>
            <input
              style={inputStyle}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>
          <Field label="Search Thesis URL" grow>
            <input
              style={inputStyle}
              value={draft.thesisUrl}
              placeholder="https://…"
              onChange={(e) => setDraft({ ...draft, thesisUrl: e.target.value })}
            />
          </Field>
          <div style={{ alignSelf: "flex-end" }}>
            <Btn tone="accent" onClick={submit}>
              {editing ? "save" : "add launch"}
            </Btn>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <Empty msg="No launches on the runway. Add one to start the pre-flight checklist." />
      )}

      {items.map((l) => {
        const done = CHECKLIST_ITEMS.filter((i) => l.checklist[i.key]).length;
        const total = CHECKLIST_ITEMS.length;
        const ready = done === total;
        const pct = Math.round((done / total) * 100);
        return (
          <div
            key={l.id}
            style={{ ...rowCard, flexDirection: "column", alignItems: "stretch", gap: 12 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flexGrow: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{l.name}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--dim)",
                    marginTop: 2,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {l.client || "—"} {l.targetDate ? `· target ${l.targetDate}` : ""} · upd{" "}
                  {l.updated}
                </div>
                {l.notes && (
                  <div style={{ fontSize: 12.5, color: "var(--dim)", marginTop: 4 }}>
                    {l.notes}
                  </div>
                )}
                {l.thesisUrl && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <LinkOut href={l.thesisUrl}>Search Thesis</LinkOut>
                  </div>
                )}
              </div>
              <Chip color={ready ? "var(--teal)" : "var(--amber)"}>
                {ready ? "READY TO LAUNCH" : `${done}/${total} pre-flight`}
              </Chip>
              <Btn small onClick={() => setEditId(l.id)}>
                edit
              </Btn>
              <Btn small tone="danger" onClick={() => remove(l.id)}>
                ✕
              </Btn>
            </div>

            <div
              style={{
                height: 5,
                background: "var(--line)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: ready ? "var(--teal)" : "var(--amber)",
                  transition: "width 0.3s",
                }}
              />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CHECKLIST_ITEMS.map((i) => {
                const on = l.checklist[i.key];
                return (
                  <button
                    key={i.key}
                    onClick={() => toggle(l.id, i.key)}
                    style={{
                      background: on ? "rgba(79,214,192,0.09)" : "var(--bg)",
                      border: `1px solid ${on ? "var(--teal)" : "var(--line)"}`,
                      color: on ? "var(--teal)" : "var(--dim)",
                      borderRadius: 4,
                      padding: "6px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    {on ? "■" : "□"} {i.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
