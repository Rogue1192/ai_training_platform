import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  MousePointerClick,
  Navigation,
  TrendingUp,
  Shield,
} from "lucide-react";
import { format } from "date-fns";

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    completed: { label: "Completed", className: "bg-green-500/10 text-green-400 border-green-500/20" },
    failed:    { label: "Failed",    className: "bg-red-500/10 text-red-400 border-red-500/20" },
    pending:   { label: "Pending",   className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    running:   { label: "Running",   className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  };
  const s = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return <Badge variant="outline" className={`text-xs ${s.className}`}>{s.label}</Badge>;
}

export default function CtrAnalytics() {
  const { data: sessions = [], isLoading: sessLoading } = trpc.ctr.listSessions.useQuery({ limit: 100 });
  const { data: campaigns = [] } = trpc.ctr.listCampaigns.useQuery();
  const { data: snapshots = [] } = trpc.ctr.listRampSnapshots.useQuery({});

  const totalSessions = sessions.length;
  const completed = sessions.filter((s: any) => s.status === "completed").length;
  const failed = sessions.filter((s: any) => s.status === "failed").length;
  const successRate = totalSessions > 0 ? Math.round((completed / totalSessions) * 100) : 0;

  const campaignMap = Object.fromEntries(campaigns.map((c: any) => [c.id, c.businessName]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CTR Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Session logs, ramp progress, and success rates</p>
      </div>

      {/* Real browser notice */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-center gap-3">
        <Shield className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs text-muted-foreground">
          All sessions use <span className="text-foreground font-medium">real Chromium browsers</span>. Headless mode is permanently disabled.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-2xl font-semibold">{totalSessions}</p>
            <p className="text-xs text-muted-foreground mt-1">Total Sessions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <p className="text-2xl font-semibold">{completed}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-400" />
              <p className="text-2xl font-semibold">{failed}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <p className="text-2xl font-semibold">{successRate}%</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Success Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Ramp Snapshots */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Weekly Ramp Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshots.map((snap: any) => (
                <div key={snap.id} className="flex items-center justify-between text-sm border-b border-border/40 pb-2 last:border-0 last:pb-0">
                  <div>
                    <span className="font-medium">{campaignMap[snap.campaignId] ?? `Campaign ${snap.campaignId}`}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      Week of {format(new Date(snap.weekStartDate), "MMM d, yyyy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Baseline: <span className="text-foreground">{snap.baselineClicks}</span></span>
                    <span>Target: <span className="text-foreground">{snap.targetClicks}</span></span>
                    <span>Delivered: <span className="text-foreground">{snap.deliveredClicks}</span></span>
                    <span>Ramp: <span className="text-primary">{snap.rampPct}%</span></span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Session Log</CardTitle>
        </CardHeader>
        <CardContent>
          {sessLoading ? (
            <p className="text-sm text-muted-foreground">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8">
              <MousePointerClick className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No sessions yet. Start a campaign to begin generating CTR sessions.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header */}
              <div className="grid grid-cols-6 text-xs text-muted-foreground pb-2 border-b border-border/40">
                <span>Campaign</span>
                <span>Type</span>
                <span>Keyword</span>
                <span>Browser</span>
                <span>Status</span>
                <span>Date</span>
              </div>
              {sessions.map((s: any) => (
                <div key={s.id} className="grid grid-cols-6 text-xs py-1.5 border-b border-border/20 last:border-0">
                  <span className="text-muted-foreground truncate">{campaignMap[s.campaignId] ?? `#${s.campaignId}`}</span>
                  <span className="flex items-center gap-1">
                    {s.sessionType === "drive" ? (
                      <><Navigation className="h-3 w-3 text-blue-400" /> Drive</>
                    ) : (
                      <><MousePointerClick className="h-3 w-3 text-primary" /> CTR</>
                    )}
                  </span>
                  <span className="text-muted-foreground truncate">{s.keyword ?? "—"}</span>
                  <span>
                    <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/20">
                      Real
                    </Badge>
                  </span>
                  <span>{statusBadge(s.status)}</span>
                  <span className="text-muted-foreground">
                    {s.createdAt ? format(new Date(s.createdAt), "MMM d, HH:mm") : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
