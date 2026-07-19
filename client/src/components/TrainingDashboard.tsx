/**
 * TrainingDashboard.tsx
 *
 * V3 training dashboard showing:
 *   - Sprint progress (4 days) or maintenance mode indicator
 *   - Per-day run status with session counts and web search results
 *   - Per-phrase graduation status per target AI (OpenAI / Google)
 *   - "View Sessions" button on each day run card → opens full dialogue viewer
 *   - "View Dialogue" button on each phrase row → shows all sessions for that phrase
 *   - Cost breakdown including MiniMax trainer costs
 *   - Admin-only "Run Now" button to trigger a test training day
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  MessageSquare,
  ChevronDown,
  ChevronUp,
  XCircle,
  CheckCircle,
  Bot,
  User,
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

// ─── Dialogue Turn Message ────────────────────────────────────────────────────

function TurnMessage({
  role,
  content,
  turn,
  isTrainerMessage,
}: {
  role: "user" | "assistant" | "trainer";
  content: string;
  turn: number;
  isTrainerMessage?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const isTrainer = role === "trainer" || isTrainerMessage;
  const isUser = role === "user" && !isTrainerMessage;

  return (
    <div
      className={`rounded-md border p-3 text-xs ${
        isTrainer
          ? "border-amber-400/30 bg-amber-400/5 ml-6"
          : isUser
          ? "border-blue-400/30 bg-blue-400/5"
          : "border-green-400/30 bg-green-400/5 ml-6"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {isUser ? (
            <User className="w-3 h-3 text-blue-400" />
          ) : isTrainer ? (
            <Bot className="w-3 h-3 text-amber-400" />
          ) : (
            <Bot className="w-3 h-3 text-green-400" />
          )}
          <span
            className={`font-semibold ${
              isUser
                ? "text-blue-400"
                : isTrainer
                ? "text-amber-400"
                : "text-green-400"
            }`}
          >
            {isUser
              ? `Turn ${turn} — Initial Query`
              : isTrainer
              ? `Turn ${turn} — MiniMax Trainer`
              : `Turn ${turn} — AI Response`}
          </span>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
      </div>
      {expanded && (
        <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {content}
        </p>
      )}
    </div>
  );
}

// ─── Session Log Card ─────────────────────────────────────────────────────────

function SessionLogCard({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
  const history: any[] = Array.isArray(log.conversationHistory)
    ? log.conversationHistory
    : [];

  const providerLabel =
    log.targetProvider === "google_ai_overview"
      ? "AI Overview"
      : log.targetProvider === "openai"
      ? "ChatGPT"
      : "Gemini";

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">
            {log.variationText}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Var {log.variationIndex + 1} · {providerLabel} · {log.totalTurns} turns
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {log.sessionWin ? (
            <Badge
              variant="outline"
              className="text-xs text-green-400 border-green-400/30 bg-green-400/10"
            >
              <CheckCircle className="w-3 h-3 mr-1" />
              Win
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-xs text-red-400 border-red-400/30 bg-red-400/10"
            >
              <XCircle className="w-3 h-3 mr-1" />
              Miss
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => setOpen(true)}
          >
            <MessageSquare className="w-3 h-3" />
            View
          </Button>
        </div>
      </div>

      {/* Clean probe result */}
      {log.cleanProbeResponse && (
        <div className="rounded border border-border/50 bg-background/50 p-2">
          <p className="text-xs text-muted-foreground font-medium mb-1">
            Clean Probe:{" "}
            <span className="font-mono text-foreground">{log.cleanProbeQuery}</span>
          </p>
          <p
            className={`text-xs italic ${
              log.cleanProbeMentioned ? "text-green-400" : "text-muted-foreground"
            }`}
          >
            {log.cleanProbeMentioned ? "✓ Business mentioned" : "✗ Not mentioned"}
          </p>
        </div>
      )}

      {/* Dialogue modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              Training Dialogue — {providerLabel}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Phrase: <span className="font-medium text-foreground">{log.phraseText}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Variation {log.variationIndex + 1}:{" "}
              <span className="italic">{log.variationText}</span>
            </p>
          </DialogHeader>

          <div className="space-y-2 mt-4">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                No dialogue turns recorded for this session.
              </p>
            ) : (
              history.map((msg: any, idx: number) => (
                <TurnMessage
                  key={idx}
                  role={msg.role}
                  content={msg.content}
                  turn={msg.turn}
                  isTrainerMessage={msg.isTrainerMessage}
                />
              ))
            )}

            {/* Clean probe section */}
            {log.cleanProbeQuery && (
              <div className="mt-4 rounded-md border border-purple-400/30 bg-purple-400/5 p-3">
                <p className="text-xs font-semibold text-purple-400 mb-2">
                  Clean Probe (Fresh Session)
                </p>
                <div className="space-y-2">
                  <div className="rounded border border-border/50 bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground font-medium mb-1">Query</p>
                    <p className="text-xs text-foreground font-mono">{log.cleanProbeQuery}</p>
                  </div>
                  <div
                    className={`rounded border p-2 ${
                      log.cleanProbeMentioned
                        ? "border-green-400/30 bg-green-400/5"
                        : "border-red-400/30 bg-red-400/5"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground font-medium mb-1">
                      AI Response{" "}
                      {log.cleanProbeMentioned ? (
                        <span className="text-green-400">✓ Business mentioned</span>
                      ) : (
                        <span className="text-red-400">✗ Not mentioned</span>
                      )}
                    </p>
                    <p className="text-xs text-foreground whitespace-pre-wrap">
                      {log.cleanProbeResponse}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Day Run Sessions Modal ───────────────────────────────────────────────────

function DayRunSessionsButton({
  dayRunId,
  runLabel,
}: {
  dayRunId: number;
  runLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: logs, isLoading } = trpc.trainingQuery.getSessionLogsByDayRun.useQuery(
    { dayRunId },
    { enabled: open }
  );

  // Group logs by phraseText
  const grouped: Record<string, any[]> = {};
  if (logs) {
    for (const log of logs) {
      if (!grouped[log.phraseText]) grouped[log.phraseText] = [];
      grouped[log.phraseText].push(log);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs gap-1 mt-2 w-full"
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="w-3 h-3" />
        View Sessions
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              {runLabel} — Training Sessions
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {logs ? `${logs.length} session(s) recorded` : "Loading…"}
            </p>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && logs && logs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                No sessions recorded for this run yet. Sessions are saved after each training day completes.
              </p>
            )}
            {!isLoading &&
              Object.entries(grouped).map(([phrase, phraseLogs]) => (
                <div key={phrase} className="space-y-2">
                  <p className="text-xs font-semibold text-foreground border-b border-border pb-1">
                    {phrase}
                  </p>
                  {phraseLogs.map((log) => (
                    <SessionLogCard key={log.id} log={log} />
                  ))}
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Phrase Dialogue Button ───────────────────────────────────────────────────

function PhraseDialogueButton({
  queryId,
  campaignId,
  phraseText,
}: {
  queryId: number;
  campaignId: number;
  phraseText: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: logs, isLoading } = trpc.trainingQuery.getSessionLogsByQuery.useQuery(
    { queryId, campaignId },
    { enabled: open }
  );

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="w-3 h-3" />
        Dialogue
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              Phrase Dialogue History
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1 italic">{phraseText}</p>
            <p className="text-xs text-muted-foreground">
              {logs ? `${logs.length} session(s) across all training days` : "Loading…"}
            </p>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && logs && logs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                No sessions recorded for this phrase yet.
              </p>
            )}
            {!isLoading &&
              logs?.map((log) => <SessionLogCard key={log.id} log={log} />)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function TrainingDashboard({ campaignId, isAdmin = false }: Props) {
  const { data: dashboard, isLoading, refetch } = trpc.trainingQuery.getDashboard.useQuery(
    { campaignId },
    { refetchInterval: 30_000 }
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
  const sprintRuns = dayRuns.filter((r: any) => r.runType === "sprint");
  const maintenanceRuns = dayRuns.filter((r: any) => r.runType === "maintenance");
  const isRunning = dayRuns.some((r: any) => r.status === "running");

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
                const run = sprintRuns.find((r: any) => r.runDay === day);
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
                            {new Date(run.scheduledDate + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })}
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
                        {/* View Sessions button */}
                        <DayRunSessionsButton
                          dayRunId={run.id}
                          runLabel={`Sprint Day ${day}`}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not scheduled yet</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Extra test runs beyond Day 4 */}
            {sprintRuns.filter((r: any) => r.runDay > 4).length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Additional Test Runs</p>
                {sprintRuns.filter((r: any) => r.runDay > 4).map((run: any) => (
                  <div
                    key={run.id}
                    className={`rounded-md border p-3 ${STATUS_BG[run.status] || "bg-muted/30"}`}
                  >
                    <div className="flex items-center justify-between">
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
                                {new Date(run.scheduledDate + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })}
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
                    <DayRunSessionsButton
                      dayRunId={run.id}
                      runLabel={`Test Run ${run.runDay}`}
                    />
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
              {maintenanceRuns.map((run: any) => (
                <div
                  key={run.id}
                  className={`rounded-md border p-3 ${STATUS_BG[run.status] || "bg-muted/30"}`}
                >
                  <div className="flex items-center justify-between">
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
                              {new Date(run.scheduledDate + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })}
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
                  <DayRunSessionsButton
                    dayRunId={run.id}
                    runLabel={`Maintenance Week ${run.runDay}`}
                  />
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
            {queries.map((q: any, i: number) => {
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
                    {/* Per-AI graduation badges + dialogue button */}
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
                      {/* Dialogue history button */}
                      <PhraseDialogueButton
                        queryId={q.id}
                        campaignId={campaignId}
                        phraseText={q.phraseText}
                      />
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
