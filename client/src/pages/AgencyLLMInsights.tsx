import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2, Search, TrendingUp, MessageSquare, Brain, Globe, Target,
  ChevronDown, ChevronRight, Building2, Clock, LogOut,
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

function formatVolume(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

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

export default function AgencyLLMInsights() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const impersonatedAgencyId = sessionStorage.getItem('impersonatedAgencyId');
  const handleExitImpersonation = () => {
    sessionStorage.removeItem('impersonatedAgencyId');
    navigate('/agencies');
  };

  const { data: queries, isLoading: queriesLoading } = trpc.agency.llmInsightsQueries.useQuery({ limit: 500 });
  const { data: stats, isLoading: statsLoading } = trpc.agency.llmInsightsStats.useQuery();

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
      if (q.lastRankCheckAt) {
        const t = new Date(q.lastRankCheckAt as unknown as string);
        if (!entry.lastScanAt || t > entry.lastScanAt) entry.lastScanAt = t;
      }
    }
    return Array.from(m.values()).sort((a, b) => a.businessName.localeCompare(b.businessName));
  }, [filtered]);

  const toggle = (cid: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(cid) ? n.delete(cid) : n.add(cid);
      return n;
    });

  const isLoading = queriesLoading || statsLoading;

  return (
    <div className="space-y-6">
      {/* Impersonation Banner */}
      {impersonatedAgencyId && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-600 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-medium">
            <span>👁</span>
            <span>Super Admin impersonation mode — LLM Insights</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-400 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 shrink-0"
            onClick={handleExitImpersonation}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Exit Impersonation
          </Button>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold text-foreground">LLM Query Insights</h1>
        <p className="text-muted-foreground mt-2">
          AI search visibility grouped by client — track which queries each business is mentioned for across ChatGPT, Gemini, and Google AI Overview.
        </p>
      </div>

      {/* Aggregate Stats */}
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
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Clients &amp; Tracked Queries</h2>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter by client, query, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background border-input"
          />
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

                {/* Expanded query table */}
                {expanded && (
                  <div className="border-t border-border">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Query</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Location</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Type</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">AI Volume</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">ChatGPT</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Gemini</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">AI Overview</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {client.rows.map((q) => (
                            <tr key={q.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                              <td className="px-4 py-2.5">
                                <span className="font-medium text-foreground">{q.searchQuery}</span>
                              </td>
                              <td className="px-4 py-2.5 text-muted-foreground">{q.location}</td>
                              <td className="px-4 py-2.5">
                                {q.isTargetLocation === false ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">
                                    ⭐ Bonus
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-400 border-blue-500/30">
                                    <Target className="w-3 h-3" /> Target
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <span className="font-semibold text-primary">{formatVolume(q.aiSearchVolume)}</span>
                              </td>
                              <td className="px-4 py-2.5"><RankBadge rank={q.currentRankChatGPT} /></td>
                              <td className="px-4 py-2.5"><RankBadge rank={q.currentRankGemini} /></td>
                              <td className="px-4 py-2.5"><RankBadge rank={q.currentRankAIOverview} /></td>
                              <td className="px-4 py-2.5"><StatusBadge status={q.trainingStatus} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
