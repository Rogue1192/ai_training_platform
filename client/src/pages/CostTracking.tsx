import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCw,
  ChevronRight,
  BarChart3,
  Users,
  Cpu,
  Globe,
  Info,
  ArrowUpDown,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, decimals = 2): string {
  return `$${n.toFixed(decimals)}`;
}

function fmtPct(n: number): string {
  return `${n}%`;
}

function billingTypeBadge(bt: string) {
  if (bt === "white_label")
    return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">White Label</Badge>;
  if (bt === "direct")
    return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">Direct</Badge>;
  if (bt === "external")
    return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">External</Badge>;
  return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">Legacy</Badge>;
}

function profitBadge(net: number, billingType: string) {
  if (billingType === "legacy" || billingType === "external") {
    return <span className="text-zinc-400 text-sm">—</span>;
  }
  if (net >= 0) {
    return (
      <span className="flex items-center gap-1 text-emerald-400 font-semibold text-sm">
        <TrendingUp className="w-3 h-3" />
        {fmt$(net)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-red-400 font-semibold text-sm">
      <TrendingDown className="w-3 h-3" />
      {fmt$(net)}
    </span>
  );
}

function marginColor(pct: number, billingType: string): string {
  if (billingType === "legacy" || billingType === "external") return "text-zinc-400";
  if (pct >= 70) return "text-emerald-400";
  if (pct >= 40) return "text-yellow-400";
  return "text-red-400";
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    training: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    monitoring: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const cls = map[status] ?? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  return <Badge className={`${cls} text-xs capitalize`}>{status}</Badge>;
}

// ─── Aggregate Summary Cards ──────────────────────────────────────────────────

function AggregateSummary() {
  const { data, isLoading, isError, refetch, isFetching } = trpc.costTracking.getAggregateSummary.useQuery({
    retry: 1,
  } as any);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-32 gap-3">
        <p className="text-sm text-muted-foreground">Failed to load summary.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const d = data;

  return (
    <div className="space-y-4">
      {/* Top-line P&L cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">{fmt$(d.totalRevenueUsd)}</div>
            <p className="text-xs text-muted-foreground">Current billing cycles</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">Total API Costs</CardTitle>
            <Cpu className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-400">{fmt$(d.totalCostUsd)}</div>
            <p className="text-xs text-muted-foreground">LLM + DataForSEO</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">Net Profit</CardTitle>
            {d.totalNetProfitUsd >= 0
              ? <TrendingUp className="h-4 w-4 text-emerald-500" />
              : <TrendingDown className="h-4 w-4 text-red-400" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${d.totalNetProfitUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {fmt$(d.totalNetProfitUsd)}
            </div>
            <p className="text-xs text-muted-foreground">Revenue minus costs</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">Avg Margin</CardTitle>
            <BarChart3 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${marginColor(d.avgMarginPct, "white_label")}`}>
              {fmtPct(d.avgMarginPct)}
            </div>
            <p className="text-xs text-muted-foreground">Across billed campaigns</p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Client Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">White Label</span>
              <span className="text-blue-400 font-medium">{d.whiteLabelCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Direct</span>
              <span className="text-purple-400 font-medium">{d.directCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Legacy (costs only)</span>
              <span className="text-zinc-400 font-medium">{d.legacyCount}</span>
            </div>
            {(d as any).externalCount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">External (billed outside)</span>
                <span className="text-orange-400 font-medium">{(d as any).externalCount}</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="text-muted-foreground">Total Campaigns</span>
              <span className="text-foreground font-semibold">{d.campaignCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> Cost by Operation (30d)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.byOperationType.length === 0 && (
              <p className="text-xs text-muted-foreground">No cost data yet</p>
            )}
            {d.byOperationType.map((op) => (
              <div key={op.operationType} className="flex justify-between text-sm">
                <span className="text-muted-foreground capitalize">{op.operationType.replace(/_/g, " ")}</span>
                <span className="text-foreground font-medium">{fmt$(op.costUsd, 4)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" /> Cost by Provider (30d)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.byProvider.length === 0 && (
              <p className="text-xs text-muted-foreground">No cost data yet</p>
            )}
            {d.byProvider.map((p) => (
              <div key={p.provider} className="flex justify-between text-sm">
                <span className="text-muted-foreground capitalize">{p.provider}</span>
                <span className="text-foreground font-medium">{fmt$(p.costUsd, 4)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs"
        >
          {isFetching ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Refresh
        </Button>
      </div>
    </div>
  );
}

// ─── Campaign Cost Log Drill-down Dialog ──────────────────────────────────────

function CostLogDialog({
  campaignId,
  businessName,
  open,
  onClose,
}: {
  campaignId: number;
  businessName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [currentCycleOnly, setCurrentCycleOnly] = useState(true);

  const { data, isLoading, isError } = trpc.costTracking.getCampaignCostLogs.useQuery(
    { campaignId, currentCycleOnly },
    { enabled: open }
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl bg-background border-border max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Cost Logs — {businessName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 mb-4">
          <Button
            variant={currentCycleOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setCurrentCycleOnly(true)}
            className="text-xs"
          >
            Current Cycle
          </Button>
          <Button
            variant={!currentCycleOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setCurrentCycleOnly(false)}
            className="text-xs"
          >
            All Time
          </Button>
          {data && (
            <span className="text-xs text-muted-foreground ml-auto">
              {data.total} entries
              {currentCycleOnly && ` · Cycle: ${new Date(data.cycleStart).toLocaleDateString()} – ${new Date(data.cycleEnd).toLocaleDateString()}`}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-muted-foreground">Failed to load cost logs. Try refreshing.</p>
          </div>
        )}

        {data && data.logs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No cost logs yet for this period. Costs are recorded as API calls are made.
          </p>
        )}

        {data && data.logs.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                <TableHead className="text-muted-foreground text-xs">Operation</TableHead>
                <TableHead className="text-muted-foreground text-xs">Provider</TableHead>
                <TableHead className="text-muted-foreground text-xs">Model</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Tokens In</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Tokens Out</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.logs.map((log) => (
                <TableRow key={log.id} className="border-border hover:bg-muted/30">
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleDateString()}{" "}
                    {new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell className="text-xs capitalize text-foreground">
                    {log.operationType.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground capitalize">{log.provider}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{log.model ?? "—"}</TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground">
                    {log.inputTokens > 0 ? log.inputTokens.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground">
                    {log.outputTokens > 0 ? log.outputTokens.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-medium text-foreground">
                    {fmt$(log.costUsd, 6)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Per-Campaign Table ───────────────────────────────────────────────────────

function CampaignCostTable() {
  const [billingFilter, setBillingFilter] = useState<"all" | "white_label" | "direct" | "legacy" | "external">("all");
  const [selectedCampaign, setSelectedCampaign] = useState<{ id: number; name: string } | null>(null);
  const updateBillingType = trpc.costTracking.updateCampaignBillingType.useMutation();
  const utils = trpc.useUtils();

  const { data, isLoading, isFetching } = trpc.costTracking.getCampaignCosts.useQuery({
    billingType: billingFilter,
    limit: 100,
    offset: 0,
  });

  const handleBillingTypeChange = async (campaignId: number, newType: string) => {
    await updateBillingType.mutateAsync({
      campaignId,
      billingType: newType as "white_label" | "direct" | "legacy" | "external",
    });
    utils.costTracking.getCampaignCosts.invalidate();
    utils.costTracking.getAggregateSummary.invalidate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Filter by billing type:</span>
        <Select value={billingFilter} onValueChange={(v) => setBillingFilter(v as any)}>
          <SelectTrigger className="w-40 h-8 text-xs bg-background border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-background border-border">
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="white_label">White Label</SelectItem>
            <SelectItem value="direct">Direct</SelectItem>
            <SelectItem value="legacy">Legacy</SelectItem>
            <SelectItem value="external">External</SelectItem>
          </SelectContent>
        </Select>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        {data && (
          <span className="text-xs text-muted-foreground ml-auto">
            {data.total} campaigns
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      {data && data.campaigns.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No campaigns found. Cost data will appear here once campaigns start running.
        </div>
      )}

      {data && data.campaigns.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border bg-muted/30">
                <TableHead className="text-muted-foreground text-xs">Client</TableHead>
                <TableHead className="text-muted-foreground text-xs">Agency</TableHead>
                <TableHead className="text-muted-foreground text-xs">Plan</TableHead>
                <TableHead className="text-muted-foreground text-xs">Billing Type</TableHead>
                <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                <TableHead className="text-muted-foreground text-xs">Billing Cycle</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Revenue</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger className="flex items-center gap-1 ml-auto">
                        Cost <Info className="w-3 h-3" />
                      </TooltipTrigger>
                      <TooltipContent className="bg-popover border-border text-xs max-w-xs">
                        LLM training + rank checks + DataForSEO keyword research for current billing cycle
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Net Profit</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Margin</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Lifetime Cost</TableHead>
                <TableHead className="text-muted-foreground text-xs w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.campaigns.map((c) => (
                <TableRow key={c.campaignId} className="border-border hover:bg-muted/20">
                  <TableCell className="text-sm font-medium text-foreground">
                    {c.businessName}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.agencyName ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.packageTierName}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={c.billingType}
                      onValueChange={(v) => handleBillingTypeChange(c.campaignId, v)}
                    >
                      <SelectTrigger className="h-6 w-32 text-xs bg-transparent border-transparent hover:border-border p-1">
                        <SelectValue>{billingTypeBadge(c.billingType)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-background border-border">
                        <SelectItem value="white_label">White Label</SelectItem>
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem value="legacy">Legacy</SelectItem>
                        <SelectItem value="external">External (billed outside)</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{statusBadge(c.campaignStatus)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(c.billingCycleStart).toLocaleDateString()} –{" "}
                    {new Date(c.billingCycleEnd).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {(c.billingType === "legacy" || c.billingType === "external") ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <span className="text-emerald-400 font-medium">{fmt$(c.monthlyRevenueUsd)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {c.totalCostUsd === 0 ? (
                      <span className="text-zinc-500 text-xs">No data yet</span>
                    ) : (
                      <span className="text-red-400 font-medium">{fmt$(c.totalCostUsd, 4)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {profitBadge(c.netProfitUsd, c.billingType)}
                  </TableCell>
                  <TableCell className={`text-right text-sm font-semibold ${marginColor(c.marginPct, c.billingType)}`}>
                    {(c.billingType === "legacy" || c.billingType === "external") ? "—" : fmtPct(c.marginPct)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {c.lifetimeCostUsd === 0 ? "—" : fmt$(c.lifetimeCostUsd, 4)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setSelectedCampaign({ id: c.campaignId, name: c.businessName })}
                    >
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {selectedCampaign && (
        <CostLogDialog
          campaignId={selectedCampaign.id}
          businessName={selectedCampaign.name}
          open={!!selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CostTracking() {
  const [activeTab, setActiveTab] = useState<"overview" | "campaigns">("overview");
  const utils = trpc.useUtils();
  const backfill = trpc.costTracking.backfillBillingTypes.useMutation({
    onSuccess: (data) => {
      utils.costTracking.getAggregateSummary.invalidate();
      utils.costTracking.getCampaignCosts.invalidate();
      alert(`Backfill complete: ${data.updated} campaign(s) updated.`);
    },
    onError: (err) => alert(`Backfill failed: ${err.message}`),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Cost Tracking
          </h1>
          <p className="text-muted-foreground mt-1">
            API costs vs. revenue — P&amp;L per client, per billing cycle
          </p>
        </div>
        <button
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending}
          className="shrink-0 px-3 py-1.5 text-xs font-medium rounded border border-yellow-500/40 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-50 transition-colors"
          title="Set billingType=legacy for campaigns with no billing type set. Run once after deploy."
        >
          {backfill.isPending ? "Backfilling..." : "Fix Null Billing Types"}
        </button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-300 flex items-start gap-3">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <strong>How billing cycles work:</strong> Each campaign resets on the same day-of-month as its creation date.
          Costs are tracked per cycle and compared against the plan's monthly revenue rate.
          Legacy clients show costs only — no revenue or P&amp;L.
          You can change a campaign's billing type using the dropdown in the table below.
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("campaigns")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "campaigns"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Per-Client Breakdown
        </button>
      </div>

      {activeTab === "overview" && <AggregateSummary />}
      {activeTab === "campaigns" && <CampaignCostTable />}
    </div>
  );
}
