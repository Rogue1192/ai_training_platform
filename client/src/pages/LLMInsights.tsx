import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2, Search, TrendingUp, MessageSquare, Brain, Globe, Target,
  Plus, Trash2, ChevronDown, ChevronRight, Building2,
} from "lucide-react";

function formatVolume(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

function isMentioned(rank: string | null | undefined): boolean {
  return !!rank && rank !== "not_mentioned";
}

function RankBadge({ rank }: { rank: string | null | undefined }) {
  if (!rank || rank === "not_mentioned") {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const colorMap: Record<string, string> = {
    mentioned: "bg-green-500/15 text-green-400 border-green-500/30",
    top_3: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    top_5: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    top_10: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  };
  const cls = colorMap[rank] || "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {rank.replace("_", " ")}
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

/** A small labelled count chip used in the client card header. */
function CountChip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border ${tone}`} title={label}>
      {icon}
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export default function LLMInsights() {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, { q: string; loc: string }>>({});

  const utils = trpc.useUtils();
  const { data: queries, isLoading: queriesLoading } = trpc.llmInsights.topQueries.useQuery({ limit: 500 });
  const { data: stats, isLoading: statsLoading } = trpc.llmInsights.aggregateStats.useQuery();

  const invalidate = () => {
    utils.llmInsights.topQueries.invalidate();
    utils.llmInsights.aggregateStats.invalidate();
  };

  const addMutation = trpc.campaign.addQueryLocations.useMutation();
  const deleteMutation = trpc.llmInsights.deleteQueryLocation.useMutation();

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

  // Group the (filtered) query rows into one card per client (campaign).
  const clients = useMemo(() => {
    const m = new Map<number, {
      campaignId: number;
      businessName: string;
      businessType: string | null;
      primaryLocation: string;
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
          rows: [],
        });
      }
      m.get(cid)!.rows.push(q);
    }
    return Array.from(m.values()).sort((a, b) => a.businessName.localeCompare(b.businessName));
  }, [filtered]);

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
    if (!q || !loc) {
      toast.error("Enter both a query and a location.");
      return;
    }
    addMutation.mutate(
      { campaignId, entries: [{ searchQuery: q, location: loc }] },
      {
        onSuccess: () => {
          toast.success(`Now tracking “${q}”`);
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
        onSuccess: () => {
          toast.success(`Stopped tracking “${label}”`);
          invalidate();
        },
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

      {/* Aggregate Stats */}
      {statsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading stats…
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: <Search className="w-5 h-5 text-blue-400" />, bg: "bg-blue-500/10", value: stats.totalQueries.toLocaleString(), label: "Total Queries Tracked" },
            { icon: <TrendingUp className="w-5 h-5 text-purple-400" />, bg: "bg-purple-500/10", value: formatVolume(stats.totalAiVolume), label: "Total AI Search Volume" },
            { icon: <Target className="w-5 h-5 text-green-400" />, bg: "bg-green-500/10", value: stats.achievedCount.toLocaleString(), label: "Queries Achieved" },
            { icon: <Brain className="w-5 h-5 text-orange-400" />, bg: "bg-orange-500/10", value: formatVolume(stats.avgAiVolume), label: "Avg AI Volume / Query" },
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
            { label: "ChatGPT Mentions", count: stats.mentionedChatGPT, icon: <MessageSquare className="w-4 h-4 text-green-400" />, color: "green" },
            { label: "Gemini Mentions", count: stats.mentionedGemini, icon: <Brain className="w-4 h-4 text-blue-400" />, color: "blue" },
            { label: "AI Overview Mentions", count: stats.mentionedAIOverview, icon: <Globe className="w-4 h-4 text-purple-400" />, color: "purple" },
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
                        className={`h-1.5 rounded-full bg-${p.color}-500`}
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
            const draft = drafts[client.campaignId] ?? { q: "", loc: client.primaryLocation };

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
                    <CountChip icon={<Search className="w-3 h-3" />} label="Queries tracked" value={client.rows.length} tone="bg-slate-500/15 text-slate-300 border-slate-500/30" />
                    <CountChip icon={<MessageSquare className="w-3 h-3 text-green-400" />} label="ChatGPT mentions" value={cg} tone="bg-green-500/10 text-green-400 border-green-500/25" />
                    <CountChip icon={<Brain className="w-3 h-3 text-blue-400" />} label="Gemini mentions" value={gem} tone="bg-blue-500/10 text-blue-400 border-blue-500/25" />
                    <CountChip icon={<Globe className="w-3 h-3 text-purple-400" />} label="AI Overview mentions" value={aio} tone="bg-purple-500/10 text-purple-400 border-purple-500/25" />
                  </div>
                </button>

                {/* Body */}
                {expanded && (
                  <CardContent className="pt-0 pb-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground border-b border-border">
                            <th className="py-2 pr-3 font-medium">Query</th>
                            <th className="py-2 px-3 font-medium">Location</th>
                            <th className="py-2 px-3 font-medium">Type</th>
                            <th className="py-2 px-3 font-medium text-right">AI Vol</th>
                            <th className="py-2 px-3 font-medium">ChatGPT</th>
                            <th className="py-2 px-3 font-medium">Gemini</th>
                            <th className="py-2 px-3 font-medium">AI Overview</th>
                            <th className="py-2 px-3 font-medium">Status</th>
                            <th className="py-2 pl-3 font-medium text-right">Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {client.rows.map((q) => (
                            <tr key={q.id} className="border-b border-border/50 last:border-0">
                              <td className="py-2 pr-3 font-medium text-foreground">{q.searchQuery}</td>
                              <td className="py-2 px-3 text-muted-foreground">{q.location}</td>
                              <td className="py-2 px-3">
                                {q.isTargetLocation === false ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-yellow-500/15 text-yellow-400 border-yellow-500/30" title="Not in the client's target list — bonus win">⭐ Bonus</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-400 border-blue-500/30" title="Explicitly targeted location"><Target className="w-3 h-3" /> Target</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-primary">{formatVolume(q.aiSearchVolume)}</td>
                              <td className="py-2 px-3"><RankBadge rank={q.currentRankChatGPT} /></td>
                              <td className="py-2 px-3"><RankBadge rank={q.currentRankGemini} /></td>
                              <td className="py-2 px-3"><RankBadge rank={q.currentRankAIOverview} /></td>
                              <td className="py-2 px-3"><StatusBadge status={q.trainingStatus} /></td>
                              <td className="py-2 pl-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-red-400"
                                  title="Stop tracking this query"
                                  disabled={deleteMutation.isPending}
                                  onClick={() => handleDelete(q.id, q.searchQuery)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Add a query */}
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                      <Input
                        placeholder="Add a query to track (e.g. “emergency plumber near me”)"
                        value={draft.q}
                        onChange={(e) => setDrafts((d) => ({ ...d, [client.campaignId]: { q: e.target.value, loc: draft.loc } }))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(client.campaignId, client.primaryLocation); }}
                        className="flex-1 bg-background border-input"
                      />
                      <Input
                        placeholder="Location"
                        value={draft.loc}
                        onChange={(e) => setDrafts((d) => ({ ...d, [client.campaignId]: { q: draft.q, loc: e.target.value } }))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(client.campaignId, client.primaryLocation); }}
                        className="w-44 bg-background border-input"
                      />
                      <Button
                        size="sm"
                        disabled={addMutation.isPending || !draft.q.trim()}
                        onClick={() => handleAdd(client.campaignId, client.primaryLocation)}
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
