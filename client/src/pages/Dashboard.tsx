import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Activity, Target, Zap, Clock, TrendingUp, Users, BarChart3, Radio } from "lucide-react";

export default function Dashboard() {
  const { data: metrics, isLoading } = trpc.dashboard.metrics.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const formatResponseTime = (ms: number) => {
    if (ms === 0) return "0.0s";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">AI Answer Forge Command Center</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">Active Trainings</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{metrics?.activeTrainings ?? 0}</div>
            <p className="text-xs text-muted-foreground">Sessions currently running</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">Completed Goals</CardTitle>
            <Target className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{metrics?.completedGoals ?? 0}</div>
            <p className="text-xs text-muted-foreground">Successful training sessions</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">API Calls Today</CardTitle>
            <Zap className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{metrics?.apiCallsToday ?? 0}</div>
            <p className="text-xs text-muted-foreground">Conversations processed</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-card-foreground">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{formatResponseTime(metrics?.avgResponseTime ?? 0)}</div>
            <p className="text-xs text-muted-foreground">Average AI response</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-card-foreground flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              Campaign Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Keyword Research</span>
                <span className="font-medium text-foreground">Coming Soon</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Content Generation</span>
                <span className="font-medium text-foreground">Coming Soon</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Active Training</span>
                <span className="font-medium text-foreground">{metrics?.activeTrainings ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Monitoring</span>
                <span className="font-medium text-foreground">Coming Soon</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-card-foreground flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">Getting Started</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Configure your AI provider API keys in Settings</li>
                <li>Add a business profile with website and location</li>
                <li>Set up a training session with your goals</li>
                <li>Monitor progress and view conversation history</li>
                <li>Schedule recurring training runs for automation</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
