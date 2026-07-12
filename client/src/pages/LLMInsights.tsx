import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, Search, TrendingUp, MessageSquare, Brain, Globe, Target,
  Plus, Trash2, ChevronDown, ChevronRight, Building2, RefreshCw,
  Clock, History, X, CheckCircle2, Filter,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMentioned(rank: string | null | undefined): boolean {
  return !!rank && rank !== "not_mentioned";
}

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: string | null | undefined }) {
  if (!rank || rank === "not_mentioned") {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-green-500/15 text-green-400 border-green-500/30">
      Mentioned
    </span>
  );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    training: { label: "Training", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    achieved: { label: "Achieved", cls: "bg-green-500/15 text-green-400 border-green-500/30" },
    monitoring: { label: "Monitoring", cls: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    recovering: { label: "Recovering", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  };
  const { label, cls } = map[status || ""] || { label: status || "—", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

function CountChip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border ${tone}`} title={label}>
      {icon}
      <span className="font-semibold">{value}</span>
    </span>
  );
}

// ─── Query History Drawer ─────────────────────────────────────────────────────

function QueryHistoryDrawer({
  queryLocationId,
  queryLabel,
  onClose,
}: {
  queryLocationId: number;
  queryLabel: string;
  onClose: () => void;
}) {
  const { data: history, isLoading } = trpc.llmInsights.queryHistory.useQuery(
    { queryLocationId, limit: 30 },
    { enabled: true }
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-foreground text-sm">{queryLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Scan history — last 30 checks</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : !history || history.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">No scan history yet — run a manual scan to populate this.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium">Date / Time</th>
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium">ChatGPT</th>
                  <th className="py-2 px-3 font-medium">Gemini</th>
                  <th className="py-2 pl-3 font-medium">AI Overview</th>
                </tr>
              </thead>
              <tbody>
                {history.map((snap) => (
                  <tr key={snap.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground text-xs whitespace-nowrap">
                      {formatDateTime(snap.checkedAt)}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-xs text-muted-foreground capitalize">{snap.checkType || "auto"}</span>
                    </td>
                    <td className="py-2 px-3">
                      {snap.chatgptMentioned ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {snap.geminiMentioned ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-3">
                      {snap.aiOverviewMentioned ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LLMInsights() {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [collapsedInitialized, setCollapsedInitialized] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, { q: string; loc: string }>>({});
  const [historyTarget, setHistoryTarget] = useState<{ id: number; label: string } | null>(null);
  const [billingFilter, setBillingFilter] = useState<string>("all");
  const [agencyFilter, setAgencyFilter] = useState<string>("all");

  const utils = trpc.useUtils();
  const { data: queries, isLoading: queriesLoading } = trpc.llmInsights.topQueries.useQuery({
    limit: 500,
    billingType: billingFilter !== "all" ? billingFilter : undefined,
    agencyId: agencyFilter !== "all" ? parseInt(agencyFilter) : undefined,
  });
  const { data: stats, isLoading: statsLoading } = trpc.llmInsights.aggregateStats.useQuery();
  const { data: agencies } = trpc.agency.list.useQuery();

  const invalidate = () => {
    utils.llmInsights.topQueries.invalidate();
    utils.llmInsights.aggregateStats.invalidate();
  };

  const addMutation = trpc.campaign.addQueryLocations.useMutation();
  const deleteMutation = trpc.llmInsights.deleteQueryLocation.useMutation();
  const manualScanMutation = trpc.llmInsights.manualScan.useMutation();

  const handleManualScan = (campaignId: number, businessName: string) => {
    manualScanMutation.mutate(
      { campaignId },
      {
        onSuccess: (r) => {
          if (r.error) {
            toast.error(`Scan failed: ${r.error}`);
          } else {
            toast.success(
              r.winsDetected > 0
                ? `Scan complete — ${r.snapshotsCreated} queries checked, ${r.winsDetected} new win${r.winsDetected !== 1 ? "s" : ""} detected for ${businessName}!`
                : `Scan complete — ${r.snapshotsCreated} queries checked for ${businessName}.`,
              { duration: 5000 }
            );
          }
          invalidate();
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const filtered = (queries || []).filter((q) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      q.searchQuery?.toLowerCase().includes(s) ||
      q.location?.toLowerCase().includes(s) ||
      q.businessName?.toLowerCase().includes(s) ||
      q.businessType?.toLowerCase().includes(s)
    );
  });

  type Row = (typeof filtered)[number];

  const clients = useMemo(() => {
    const m = new Map<number, {
      campaignId: number;
      businessName: string;
      businessType: string | null;
      primaryLocation: string;
      lastScanAt: Date | null;
      rows: Row[];
    }>();
    for (const q of filtered) {
      const cid = q.campaignId;
      if (cid == null) continue;
      if (!m.has(cid)) {
        m.set(cid, {
          campaignId: cid,
          businessName: q.businessName || "Unknown business",
          businessType: q.businessType ?? null,
          primaryLocation: q.location || "",
          lastScanAt: q.lastRankCheckAt ? new Date(q.lastRankCheckAt as unknown as string) : null,
          rows: [],
        });
      }
      const entry = m.get(cid)!;
      entry.rows.push(q);
      // Track the most recent scan across all queries for this campaign
      if (q.lastRankCheckAt) {
        const t = new Date(q.lastRankCheckAt as unknown as string);
        if (!entry.lastScanAt || t > entry.lastScanAt) entry.lastScanAt = t;
      }
    }
    return Array.from(m.values()).sort((a, b) => a.businessName.localeCompare(b.businessName));
  }, [filtered]);

  // Collapse all cards by default once data is loaded
  useEffect(() => {
    if (!collapsedInitialized && clients.length > 0) {
      setCollapsed(new Set(clients.map((c) => c.campaignId)));
      setCollapsedInitialized(true);
    }
  }, [clients, collapsedInitialized]);

  const toggle = (cid: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(cid) ? n.delete(cid) : n.add(cid);
      return n;
    });

  const handleAdd = (campaignId: number, primaryLocation: string) => {
    const draft = drafts[campaignId] ?? { q: "", loc: primaryLocation };
    const q = draft.q.trim();
    const loc = (draft.loc || primaryLocation).trim();
    if (!q || !loc) { toast.error("Enter both a query and a location."); return; }
    addMutation.mutate(
      { campaignId, entries: [{ searchQuery: q, location: loc }] },
      {
        onSuccess: () => {
          toast.success(`Now tracking "${q}"`);
          setDrafts((d) => ({ ...d, [campaignId]: { q: "", loc: primaryLocation } }));
          invalidate();
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const handleDelete = (id: number, label: string) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => { toast.success(`Stopped tracking "${label}"`); invalidate(); },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const isLoading = queriesLoading || statsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">LLM Insights</h1>
        <p className="text-muted-foreground mt-2">
          AI search visibility grouped by client — track which queries each business is mentioned for across ChatGPT, Gemini, and Google AI Overview.
        </p>
      </div>

      {/* Aggregate Stats — 3 cards (AI Volume removed) */}
      {statsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading stats…
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: <Search className="w-5 h-5 text-blue-400" />, bg: "bg-blue-500/10", value: stats.totalQueries.toLocaleString(), label: "Total Queries Tracked" },
            { icon: <Target className="w-5 h-5 text-green-400" />, bg: "bg-green-500/10", value: stats.achievedCount.toLocaleString(), label: "Queries Achieved" },
            { icon: <TrendingUp className="w-5 h-5 text-purple-400" />, bg: "bg-purple-500/10", value: `${stats.totalQueries > 0 ? Math.round(((stats.mentionedChatGPT + stats.mentionedGemini + stats.mentionedAIOverview) / (stats.totalQueries * 3)) * 100) : 0}%`, label: "Overall Mention Rate" },
          ].map((c) => (
            <Card key={c.label} className="bg-card border-border">
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>{c.icon}</div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{c.value}</p>
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Platform Mention Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "ChatGPT Mentions", count: stats.mentionedChatGPT, icon: <MessageSquare className="w-4 h-4 text-green-400" />, barCls: "bg-green-500" },
            { label: "Gemini Mentions", count: stats.mentionedGemini, icon: <Brain className="w-4 h-4 text-blue-400" />, barCls: "bg-blue-500" },
            { label: "AI Overview Mentions", count: stats.mentionedAIOverview, icon: <Globe className="w-4 h-4 text-purple-400" />, barCls: "bg-purple-500" },
          ].map((p) => (
            <Card key={p.label} className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.icon}
                    <span className="text-sm text-muted-foreground">{p.label}</span>
                  </div>
                  <span className="text-xl font-bold text-foreground">{p.count.toLocaleString()}</span>
                </div>
                {stats.totalQueries > 0 && (
                  <div className="mt-2">
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${p.barCls}`}
                        style={{ width: `${Math.min(100, (p.count / stats.totalQueries) * 100).toFixed(1)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {((p.count / stats.totalQueries) * 100).toFixed(1)}% mention rate
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Clients */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Clients &amp; Tracked Queries</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Billing type filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <Select value={billingFilter} onValueChange={setBillingFilter}>
              <SelectTrigger className="w-40 h-8 text-xs bg-background border-input">
                <SelectValue placeholder="All billing types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All billing types</SelectItem>
                <SelectItem value="white_label">White Label</SelectItem>
                <SelectItem value="direct">Direct</SelectItem>
                <SelectItem value="legacy">Legacy</SelectItem>
                <SelectItem value="no_charge">No Charge</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Agency filter */}
          {agencies && agencies.length > 0 && (
            <Select value={agencyFilter} onValueChange={setAgencyFilter}>
              <SelectTrigger className="w-44 h-8 text-xs bg-background border-input">
                <SelectValue placeholder="All agencies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agencies</SelectItem>
                {agencies.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Text search */}
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter by client, query, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-xs bg-background border-input"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-border rounded-lg">
          {search ? "No clients or queries match your filter." : "No tracked queries yet. Queries appear here once a campaign is created for a client."}
        </div>
      ) : (
        <div className="space-y-4">
          {clients.map((client) => {
            const expanded = !collapsed.has(client.campaignId);
            const cg = client.rows.filter((r) => isMentioned(r.currentRankChatGPT)).length;
            const gem = client.rows.filter((r) => isMentioned(r.currentRankGemini)).length;
            const aio = client.rows.filter((r) => isMentioned(r.currentRankAIOverview)).length;
            const draft = drafts[client.campaignId] ?? { q: "", loc: client.primaryLocation };
            const isScanning = manualScanMutation.isPending && manualScanMutation.variables?.campaignId === client.campaignId;

            return (
              <Card key={client.campaignId} className="bg-card border-border overflow-hidden">
                {/* Header */}
                <button
                  onClick={() => toggle(client.campaignId)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{client.businessName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {client.businessType || "—"}{client.primaryLocation ? ` · ${client.primaryLocation}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Last scan timestamp */}
                    <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground" title={client.lastScanAt ? formatDateTime(client.lastScanAt) : "Never scanned"}>
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(client.lastScanAt)}
                    </span>
                    <CountChip icon={<Search className="w-3 h-3" />} label="Queries tracked" value={client.rows.length} tone="bg-slate-500/15 text-slate-300 border-slate-500/30" />
                    <CountChip icon={<MessageSquare className="w-3 h-3 text-green-400" />} label="ChatGPT mentions" value={cg} tone="bg-green-500/10 text-green-400 border-green-500/25" />
                    <CountChip icon={<Brain className="w-3 h-3 text-blue-400" />} label="Gemini mentions" value={gem} tone="bg-blue-500/10 text-blue-400 border-blue-500/25" />
                    <CountChip icon={<Globe className="w-3 h-3 text-purple-400" />} label="AI Overview mentions" value={aio} tone="bg-purple-500/10 text-purple-400 border-purple-500/25" />
                  </div>
                </button>

                {/* Body */}
                {expanded && (
                  <CardContent className="pt-0 pb-4">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{client.rows.length} tracked quer{client.rows.length === 1 ? "y" : "ies"}</span>
                        {client.lastScanAt && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last scan: <span className="text-foreground/70">{formatDateTime(client.lastScanAt)}</span>
                          </span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        title="Run a live LLM visibility check for all queries in this campaign"
                        disabled={isScanning}
                        onClick={(e) => { e.stopPropagation(); handleManualScan(client.campaignId, client.businessName); }}
                      >
                        {isScanning ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        {isScanning ? "Scanning…" : "Run Scan Now"}
                      </Button>
                    </div>

                    {/* Query table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground border-b border-border">
                            <th className="py-2 pr-3 font-medium">Query</th>
                            <th className="py-2 px-3 font-medium">Location</th>
                            <th className="py-2 px-3 font-medium">Type</th>
                            <th className="py-2 px-3 font-medium">ChatGPT</th>
                            <th className="py-2 px-3 font-medium">Gemini</th>
                            <th className="py-2 px-3 font-medium">AI Overview</th>
                            <th className="py-2 px-3 font-medium">Status</th>
                            <th className="py-2 px-3 font-medium">Last Checked</th>
                            <th className="py-2 pl-3 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {client.rows.map((q) => (
                            <tr key={q.id} className="border-b border-border/50 last:border-0 group">
                              <td className="py-2 pr-3 font-medium text-foreground">{q.searchQuery}</td>
                              <td className="py-2 px-3 text-muted-foreground">{q.location}</td>
                              <td className="py-2 px-3">
                                {q.isTargetLocation === false ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-yellow-500/15 text-yellow-400 border-yellow-500/30" title="Not in the client's target list — bonus win">⭐ Bonus</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-400 border-blue-500/30" title="Explicitly targeted location"><Target className="w-3 h-3" /> Target</span>
                                )}
                              </td>
                              <td className="py-2 px-3"><RankBadge rank={q.currentRankChatGPT} /></td>
                              <td className="py-2 px-3"><RankBadge rank={q.currentRankGemini} /></td>
                              <td className="py-2 px-3"><RankBadge rank={q.currentRankAIOverview} /></td>
                              <td className="py-2 px-3"><StatusBadge status={q.trainingStatus} /></td>
                              <td className="py-2 px-3">
                                <span
                                  className="text-xs text-muted-foreground whitespace-nowrap"
                                  title={q.lastRankCheckAt ? formatDateTime(q.lastRankCheckAt) : "Never checked"}
                                >
                                  {formatRelativeTime(q.lastRankCheckAt)}
                                </span>
                              </td>
                              <td className="py-2 pl-3 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-blue-400"
                                    title="View scan history for this query"
                                    onClick={() => setHistoryTarget({ id: q.id, label: `${q.searchQuery} — ${q.location}` })}
                                  >
                                    <History className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                                    title="Stop tracking this query"
                                    disabled={deleteMutation.isPending}
                                    onClick={() => handleDelete(q.id, q.searchQuery)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>


                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* History Drawer */}
      {historyTarget && (
        <QueryHistoryDrawer
          queryLocationId={historyTarget.id}
          queryLabel={historyTarget.label}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}
