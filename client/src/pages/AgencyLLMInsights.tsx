import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, TrendingUp, MessageSquare, Brain, Globe, Target } from "lucide-react";

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
  const { label, cls } = map[status || ""] || {
    label: status || "—",
    cls: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

export default function AgencyLLMInsights() {
  const [search, setSearch] = useState("");

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

  const isLoading = queriesLoading || statsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">LLM Query Insights</h1>
        <p className="text-muted-foreground mt-2">
          All queries tracked across your clients, ranked by AI search volume — showing what real users ask AI platforms
        </p>
      </div>

      {/* Aggregate Stats */}
      {statsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading stats…
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Search className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats.totalQueries.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Queries Tracked</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{formatVolume(stats.totalAiVolume)}</p>
                  <p className="text-xs text-muted-foreground">Total AI Search Volume</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Target className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats.achievedCount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Queries Achieved</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{formatVolume(stats.avgAiVolume)}</p>
                  <p className="text-xs text-muted-foreground">Avg AI Volume / Query</p>
                </div>
              </div>
            </CardContent>
          </Card>
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

      {/* Query Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Top Queries by AI Search Volume</CardTitle>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Filter by query, location, business…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-background border-input"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search
                ? "No queries match your filter."
                : "No query data yet. Queries appear after keyword research runs for a campaign."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">AI Volume</TableHead>
                    <TableHead>ChatGPT</TableHead>
                    <TableHead>Gemini</TableHead>
                    <TableHead>AI Overview</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((q, i) => (
                    <TableRow key={q.id}>
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground text-sm">{q.searchQuery}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-sm">{q.location}</span>
                      </TableCell>
                      <TableCell>
                        {q.isTargetLocation === false ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-yellow-500/15 text-yellow-400 border-yellow-500/30" title="Bonus win — not in target list">
                            ⭐ Bonus
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-400 border-blue-500/30" title="Explicitly targeted location">
                            <Target className="w-3 h-3" /> Target
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm text-foreground">{q.businessName || "—"}</p>
                          {q.businessType && (
                            <p className="text-xs text-muted-foreground">{q.businessType}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold text-primary text-sm">
                          {formatVolume(q.aiSearchVolume)}
                        </span>
                      </TableCell>
                      <TableCell><RankBadge rank={q.currentRankChatGPT} /></TableCell>
                      <TableCell><RankBadge rank={q.currentRankGemini} /></TableCell>
                      <TableCell><RankBadge rank={q.currentRankAIOverview} /></TableCell>
                      <TableCell><StatusBadge status={q.trainingStatus} /></TableCell>
                      <TableCell className="text-right">
                        <span className="text-muted-foreground text-sm">{q.trainingSessions ?? 0}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
