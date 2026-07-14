/**
 * TrainingDashboard.tsx
 *
 * V3 training dashboard showing:
 *   - Sprint progress (4 days) or maintenance mode indicator
 *   - Per-day run status with session counts and web search results
 *   - Per-phrase graduation status per target AI (OpenAI / Google)
 *   - Cost breakdown including MiniMax trainer costs
 *   - Admin-only "Run Now" button to trigger a test training day
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Clock,
  Loader2,
  Trophy,
  Brain,
  Globe,
  Activity,
  Calendar,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Play,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  campaignId: number;
  isAdmin?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
};

const STATUS_BG: Record<string, string> = {
  pending: "bg-muted/30",
  running: "bg-blue-500/10 border-blue-500/30",
  completed: "bg-green-500/10 border-green-500/30",
  failed: "bg-red-500/10 border-red-500/30",
};

export function TrainingDashboard({ campaignId, isAdmin = false }: Props) {
  const { data: dashboard, isLoading, refetch } = trpc.trainingQuery.getDashboard.useQuery(
    { campaignId },
    { refetchInterval: 30_000 } // Poll every 30s while running
  );

  const triggerTestMutation = trpc.trainingQuery.triggerTestTrainingDay.useMutation({
    onSuccess: (data) => {
      toast.success(`Training day ${data.runDay} started (Day Run ID: ${data.dayRunId})`);
      refetch();
    },
    onError: (err) => {
      toast.error(`Failed to start training: ${err.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <Brain className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No training data yet. Lock your queries to start the sprint.</p>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-2 text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
              onClick={() => triggerTestMutation.mutate({ campaignId })}
              disabled={triggerTestMutation.isPending}
            >
              {triggerTestMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Run Now (Admin Test)
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const { summary, dayRuns, queries } = dashboard;
  const sprintRuns = dayRuns.filter((r) => r.runType === "sprint");
  const maintenanceRuns = dayRuns.filter((r) => r.runType === "maintenance");

  // Check if any run is currently in progress
  const isRunning = dayRuns.some((r) => r.status === "running");

  return (
    <div className="space-y-4">
      {/* Admin "Run Now" button */}
      {isAdmin && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-amber-400/20 bg-amber-400/5">
          <div>
            <p className="text-sm font-medium text-amber-400">Admin Test Mode</p>
            <p className="text-xs text-muted-foreground">
              Bypass gate checks and immediately run a training day. Queries must be saved first.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-amber-400 border-amber-400/30 hover:bg-amber-400/10 flex-shrink-0 ml-4"
            onClick={() => triggerTestMutation.mutate({ campaignId })}
            disabled={triggerTestMutation.isPending || isRunning}
          >
            {triggerTestMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isRunning ? "Running..." : "Run Now"}
          </Button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{summary.totalPhrases}</p>
            <p className="text-xs text-muted-foreground">Total Phrases</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{summary.graduatedOpenAI}</p>
            <p className="text-xs text-muted-foreground">Graduated (ChatGPT)</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{summary.graduatedGoogle}</p>
            <p className="text-xs text-muted-foreground">Graduated (Gemini)</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <Badge
              variant="outline"
              className={
                summary.currentMode === "sprint"
                  ? "text-blue-400 border-blue-400/30 bg-blue-400/10 text-sm px-3 py-1"
                  : "text-purple-400 border-purple-400/30 bg-purple-400/10 text-sm px-3 py-1"
              }
            >
              {summary.currentMode === "sprint" ? "Sprint Mode" : "Maintenance Mode"}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.currentMode === "sprint"
                ? `Day ${summary.sprintDaysCompleted}/4 complete`
                : `${summary.maintenanceRunsCompleted} weekly runs done`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sprint progress */}
      {sprintRuns.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              4-Day Onboarding Sprint
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Sprint progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Sprint Progress</span>
                <span>{summary.sprintDaysCompleted} / 4 days</span>
              </div>
              <Progress value={(summary.sprintDaysCompleted / 4) * 100} className="h-2" />
            </div>

            {/* Day run cards */}
            <div className="grid gap-2 md:grid-cols-4">
              {[1, 2, 3, 4].map((day) => {
                const run = sprintRuns.find((r) => r.runDay === day);
                const status = run?.status ?? "pending";
                return (
                  <div
                    key={day}
                    className={`rounded-md border p-3 ${STATUS_BG[status] || "bg-muted/30"}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-foreground">Day {day}</span>
                      {status === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
                      {status === "completed" && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                      {status === "pending" && <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                      {status === "failed" && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                    </div>
                    {run ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Sessions</span>
                          <span className={STATUS_COLORS[status]}>
                            {run.sessionsCompleted}/{run.sessionsTotal}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Graduated</span>
                          <span className="text-green-400">{run.phrasesGraduated}</span>
                        </div>
                        {run.scheduledDate && (
                          <div className="text-xs text-muted-foreground">
                            {new Date(run.scheduledDate).toLocaleDateString()}
                          </div>
                        )}
                        {/* Web search status */}
                        <div className="flex items-center gap-1 text-xs">
                          <Globe className="w-3 h-3 text-muted-foreground" />
                          <span className={
                            run.webSearchStatus === "completed" ? "text-green-400" :
                            run.webSearchStatus === "running" ? "text-blue-400" :
                            "text-muted-foreground"
                          }>
                            {run.webSearchStatus === "completed" ? "Web search done" :
                             run.webSearchStatus === "running" ? "Web search running..." :
                             "Web search pending"}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not scheduled yet</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Show extra day runs beyond 4 (test runs) */}
            {sprintRuns.filter((r) => r.runDay > 4).length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Additional Test Runs</p>
                {sprintRuns.filter((r) => r.runDay > 4).map((run) => (
                  <div
                    key={run.id}
                    className={`rounded-md border p-3 flex items-center justify-between ${STATUS_BG[run.status] || "bg-muted/30"}`}
                  >
                    <div className="flex items-center gap-3">
                      {run.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
                      {run.status === "completed" && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                      {run.status === "pending" && <Clock className="w-4 h-4 text-muted-foreground" />}
                      {run.status === "failed" && <AlertTriangle className="w-4 h-4 text-red-400" />}
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Test Run {run.runDay}
                          {run.scheduledDate && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {new Date(run.scheduledDate).toLocaleDateString()}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {run.sessionsCompleted}/{run.sessionsTotal} sessions · {run.phrasesGraduated} graduated
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs capitalize ${STATUS_COLORS[run.status]}`}
                    >
                      {run.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Maintenance runs */}
      {maintenanceRuns.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-purple-400" />
              Weekly Maintenance Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {maintenanceRuns.map((run) => (
                <div
                  key={run.id}
                  className={`rounded-md border p-3 flex items-center justify-between ${STATUS_BG[run.status] || "bg-muted/30"}`}
                >
                  <div className="flex items-center gap-3">
                    {run.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
                    {run.status === "completed" && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                    {run.status === "pending" && <Clock className="w-4 h-4 text-muted-foreground" />}
                    {run.status === "failed" && <AlertTriangle className="w-4 h-4 text-red-400" />}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Week {run.runDay}
                        {run.scheduledDate && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {new Date(run.scheduledDate).toLocaleDateString()}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {run.sessionsCompleted}/{run.sessionsTotal} sessions · {run.phrasesGraduated} graduated
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${STATUS_COLORS[run.status]}`}
                  >
                    {run.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phrase-level graduation status */}
      {queries.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              Phrase Graduation Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {queries.map((q, i) => {
              const openaiStatus = q.phraseStatuses?.find((s: any) => s.targetAiProvider === "openai");
              const googleStatus = q.phraseStatuses?.find((s: any) => s.targetAiProvider === "google");

              return (
                <div key={q.id} className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-5 flex-shrink-0">{i + 1}.</span>
                        <span className="text-sm text-foreground font-medium truncate">{q.phraseText}</span>
                      </div>
                    </div>
                    {/* Per-AI graduation badges */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* ChatGPT */}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">GPT</span>
                        {openaiStatus?.isGraduated ? (
                          <Badge variant="outline" className="text-xs text-green-400 border-green-400/30 bg-green-400/10">
                            Graduated
                          </Badge>
                        ) : openaiStatus ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {openaiStatus.consecutiveWins}/2 wins
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Not started
                          </Badge>
                        )}
                      </div>
                      {/* Gemini */}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Gemini</span>
                        {googleStatus?.isGraduated ? (
                          <Badge variant="outline" className="text-xs text-green-400 border-green-400/30 bg-green-400/10">
                            Graduated
                          </Badge>
                        ) : googleStatus ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {googleStatus.consecutiveWins}/2 wins
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Not started
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Last web search snippet */}
                  {(openaiStatus?.lastWebSearchSnippet || googleStatus?.lastWebSearchSnippet) && (
                    <div className="mt-2 ml-7 text-xs text-muted-foreground italic truncate">
                      "{openaiStatus?.lastWebSearchSnippet || googleStatus?.lastWebSearchSnippet}"
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
