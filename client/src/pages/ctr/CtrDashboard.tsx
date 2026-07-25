import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MousePointerClick,
  Navigation,
  BarChart3,
  TrendingUp,
  Shield,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

export default function CtrDashboard() {
  const [, setLocation] = useLocation();
  const { data: campaigns = [] } = trpc.ctr.listCampaigns.useQuery();
  const { data: sessions = [] } = trpc.ctr.listSessions.useQuery({ limit: 5 });

  const activeCampaigns = campaigns.filter((c: any) => c.status === "active").length;
  const gscConnected = campaigns.filter((c: any) => c.gscSiteUrl).length;
  const completedSessions = sessions.filter((s: any) => s.status === "completed").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CTR Module</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real browser GBP click-through rate campaigns with GSC-driven ramp control
        </p>
      </div>

      {/* Real browser enforcement notice */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-center gap-3">
        <Shield className="h-5 w-5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-medium">Real Browser Enforcement Active</p>
          <p className="text-xs text-muted-foreground">
            All sessions use real Chromium browsers. Headless mode is permanently disabled for all GBP CTR work.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                <MousePointerClick className="h-4 w-4 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{activeCampaigns}</p>
                <p className="text-xs text-muted-foreground">Active Campaigns</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{completedSessions}</p>
                <p className="text-xs text-muted-foreground">Sessions Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{gscConnected}</p>
                <p className="text-xs text-muted-foreground">GSC Connected</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick nav cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => setLocation("/ctr/campaigns")}
          className="rounded-xl border p-5 text-left hover:border-primary/40 hover:bg-muted/30 transition-all group"
        >
          <div className="flex items-start justify-between">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
              <MousePointerClick className="h-5 w-5 text-primary" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
          </div>
          <p className="font-medium text-sm">CTR Campaigns</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create and manage GBP click campaigns with keyword weighting and ramp control
          </p>
          <div className="mt-3">
            <Badge variant="outline" className="text-xs">{campaigns.length} campaigns</Badge>
          </div>
        </button>

        <button
          onClick={() => setLocation("/ctr/drive")}
          className="rounded-xl border p-5 text-left hover:border-primary/40 hover:bg-muted/30 transition-all group"
        >
          <div className="flex items-start justify-between">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center mb-3">
              <Navigation className="h-5 w-5 text-blue-400" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
          </div>
          <p className="font-medium text-sm">Drive Simulation</p>
          <p className="text-xs text-muted-foreground mt-1">
            Simulate GPS direction requests with customer personas and calendar event creation
          </p>
          <div className="mt-3">
            <Badge variant="outline" className="text-xs">Driving · Transit · Walking · Cycling</Badge>
          </div>
        </button>

        <button
          onClick={() => setLocation("/ctr/analytics")}
          className="rounded-xl border p-5 text-left hover:border-primary/40 hover:bg-muted/30 transition-all group"
        >
          <div className="flex items-start justify-between">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-3">
              <BarChart3 className="h-5 w-5 text-purple-400" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
          </div>
          <p className="font-medium text-sm">Analytics</p>
          <p className="text-xs text-muted-foreground mt-1">
            Session logs, ramp progress snapshots, and success rate tracking per campaign
          </p>
          <div className="mt-3">
            <Badge variant="outline" className="text-xs">{sessions.length} sessions logged</Badge>
          </div>
        </button>
      </div>

      {/* GSC connection status */}
      {campaigns.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm font-medium mb-3">GSC Connection Status</p>
            <div className="space-y-2">
              {campaigns.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{c.businessName}</span>
                  {c.gscSiteUrl ? (
                    <span className="flex items-center gap-1 text-green-400 text-xs">
                      <CheckCircle2 className="h-3 w-3" />
                      {c.gscSiteUrl}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-400 text-xs">
                      <AlertCircle className="h-3 w-3" />
                      Not connected
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
