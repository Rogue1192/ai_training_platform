import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  Search,
  Shield,
  FileText,
  Globe,
  Zap,
  Eye,
  Brain,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  Rocket,
  Copy,
  ExternalLink,
  Settings2,
  BarChart3,
  Activity,
  ChevronDown,
  ChevronUp,
  History,
  Code,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { toast } from "sonner";

// Pipeline step configuration
const PIPELINE_STEPS = [
  { key: "keyword_research", label: "Keywords", icon: Search, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  { key: "credibility_research", label: "Credibility", icon: Shield, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
  { key: "content_generation", label: "Content", icon: FileText, color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/30" },
  { key: "publishing", label: "Publish", icon: Globe, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
  { key: "indexing", label: "Indexing", icon: Zap, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  { key: "indexing_verification", label: "Verify", icon: CheckCircle2, color: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/30" },
  { key: "baseline_check", label: "Baseline", icon: Eye, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  { key: "training", label: "Training", icon: Brain, color: "text-primary", bg: "bg-primary/10", border: "border-primary/30" },
] as const;

type StepKey = typeof PIPELINE_STEPS[number]["key"];

const statusTimestampMap: Record<string, string> = {
  keyword_research: "keywordResearchCompletedAt",
  credibility_research: "credibilityResearchCompletedAt",
  content_generation: "contentGenerationCompletedAt",
  publishing: "publishingCompletedAt",
  indexing: "indexingSubmittedAt",
  indexing_verification: "indexingVerifiedAt",
  baseline_check: "baselineCheckCompletedAt",
  training: "trainingStartedAt",
};

const modeColors: Record<string, string> = {
  aggressive: "bg-red-500/10 text-red-400 border-red-500/30",
  moderate: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  maintenance: "bg-green-500/10 text-green-400 border-green-500/30",
};

export default function CampaignDetail() {
  const [, params] = useRoute("/campaigns/:id");
  const [, navigate] = useLocation();
  const campaignId = Number(params?.id);
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [showModeDialog, setShowModeDialog] = useState(false);
  const [selectedMode, setSelectedMode] = useState<string>("");

  const { data: campaign, isLoading, refetch: refetchCampaign } = trpc.campaign.get.useQuery(
    { id: campaignId },
    { enabled: !!campaignId }
  );
  const { data: pipelineStatus, refetch: refetchPipeline } = trpc.pipeline.getStatus.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  const { data: queryLocations } = trpc.campaign.getQueryLocations.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  const { data: scheduleStatus } = trpc.smartScheduler.getCampaignStatus.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  const { data: modeRecommendation } = trpc.smartScheduler.getRecommendation.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  const { data: wins } = trpc.wins.detectWins.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  const { data: rankReport } = trpc.rankTracking.getReport.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  const { data: webhookLogs } = trpc.webhookLog.list.useQuery({ limit: 10 });
  const { data: enrichmentStatus } = trpc.trainingContext.getEnrichmentStatus.useQuery(
    { businessId: campaign?.businessId ?? 0 },
    { enabled: !!campaign?.businessId }
  );

  const runStepMutation = trpc.pipeline.runStep.useMutation({
    onSuccess: (result) => {
      toast.success(`Step completed: ${result.step}`);
      setRunningStep(null);
      refetchCampaign();
      refetchPipeline();
    },
    onError: (error) => {
      toast.error(`Step failed: ${error.message}`);
      setRunningStep(null);
    },
  });

  const runFullMutation = trpc.pipeline.runFull.useMutation({
    onSuccess: (result) => {
      toast.success(`Pipeline completed ${result.stepsRun?.length ?? 0} steps`);
      refetchCampaign();
      refetchPipeline();
    },
    onError: (error) => {
      toast.error(`Pipeline error: ${error.message}`);
    },
  });

  const applyModeMutation = trpc.smartScheduler.applyModeChange.useMutation({
    onSuccess: () => {
      toast.success("Training mode updated");
      setShowModeDialog(false);
      refetchCampaign();
    },
    onError: (error) => {
      toast.error(`Failed to update mode: ${error.message}`);
    },
  });

  const updateCampaignMutation = trpc.campaign.update.useMutation({
    onSuccess: () => {
      toast.success("Campaign updated");
      refetchCampaign();
    },
  });

  // Compute pipeline progress
  const pipelineProgress = useMemo(() => {
    if (!campaign) return { completed: 0, total: 8, percent: 0 };
    let completed = 0;
    PIPELINE_STEPS.forEach((step) => {
      const tsKey = statusTimestampMap[step.key];
      if (tsKey && (campaign as any)[tsKey]) completed++;
    });
    return { completed, total: 8, percent: Math.round((completed / 8) * 100) };
  }, [campaign]);

  // Determine step status
  const getStepStatus = (stepKey: string): "completed" | "active" | "pending" | "error" => {
    if (!campaign) return "pending";
    const tsKey = statusTimestampMap[stepKey];
    if (tsKey && (campaign as any)[tsKey]) return "completed";
    if (campaign.status === stepKey) return "active";
    if (campaign.status === "error" && campaign.lastError) return "error";
    return "pending";
  };

  if (isLoading || !campaignId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertTriangle className="w-12 h-12 text-muted-foreground" />
        <p className="text-muted-foreground">Campaign not found</p>
        <Button variant="outline" onClick={() => navigate("/campaigns")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Campaigns
        </Button>
      </div>
    );
  }

  const handleRunStep = (step: StepKey) => {
    setRunningStep(step);
    runStepMutation.mutate({ campaignId, step });
  };

  const handleRunFull = () => {
    runFullMutation.mutate({ campaignId });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/campaigns")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {campaign.campaignName || `Campaign #${campaign.id}`}
            </h1>
            <Badge
              variant="outline"
              className={
                campaign.status === "error"
                  ? "bg-destructive/10 text-destructive border-destructive/20"
                  : campaign.status === "monitoring"
                  ? "bg-green-500/10 text-green-400 border-green-500/30"
                  : "bg-primary/10 text-primary border-primary/20"
              }
            >
              {campaign.status?.replace(/_/g, " ")}
            </Badge>
            {campaign.trainingAggressiveness && (
              <Badge variant="outline" className={modeColors[campaign.trainingAggressiveness] || ""}>
                {campaign.trainingAggressiveness}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {(campaign as any).businessName || "Unknown Business"} — Created {new Date(campaign.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              updateCampaignMutation.mutate({
                id: campaignId,
                status: campaign.status === "paused" ? "pending" : "paused",
              });
            }}
          >
            {campaign.status === "paused" ? (
              <>
                <Play className="w-4 h-4 mr-2" />
                Resume
              </>
            ) : (
              <>
                <Pause className="w-4 h-4 mr-2" />
                Pause
              </>
            )}
          </Button>
          <Button onClick={handleRunFull} disabled={runFullMutation.isPending}>
            {runFullMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4 mr-2" />
            )}
            Run Full Pipeline
          </Button>
        </div>
      </div>

      {/* Pipeline Progress Bar */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-foreground">Pipeline Progress</span>
            <span className="text-sm text-muted-foreground">
              {pipelineProgress.completed}/{pipelineProgress.total} steps completed
            </span>
          </div>
          <Progress value={pipelineProgress.percent} className="h-2" />
          
          {/* Step indicators */}
          <div className="grid grid-cols-8 gap-2 mt-4">
            {PIPELINE_STEPS.map((step) => {
              const status = getStepStatus(step.key);
              const Icon = step.icon;
              const isRunning = runningStep === step.key;
              return (
                <Tooltip key={step.key}>
                  <TooltipTrigger asChild>
                    <button
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all cursor-pointer
                        ${status === "completed" ? "bg-green-500/10 border border-green-500/30" : ""}
                        ${status === "active" ? `${step.bg} border ${step.border} animate-pulse` : ""}
                        ${status === "error" ? "bg-destructive/10 border border-destructive/30" : ""}
                        ${status === "pending" ? "bg-muted/30 border border-transparent hover:border-border" : ""}
                      `}
                      onClick={() => {
                        if (status !== "completed" && !isRunning) {
                          handleRunStep(step.key);
                        }
                      }}
                      disabled={isRunning || runStepMutation.isPending}
                    >
                      {isRunning ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      ) : status === "completed" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : status === "error" ? (
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                      ) : (
                        <Icon className={`w-4 h-4 ${status === "active" ? step.color : "text-muted-foreground"}`} />
                      )}
                      <span className={`text-[10px] font-medium leading-tight text-center ${
                        status === "completed" ? "text-green-400" :
                        status === "active" ? step.color :
                        "text-muted-foreground"
                      }`}>
                        {step.label}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{step.label} — {status === "completed" ? "Done" : status === "active" ? "In Progress" : status === "error" ? "Error" : "Click to run"}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Error Banner */}
      {campaign.lastError && (
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Pipeline Error</p>
              <p className="text-sm text-destructive/80 mt-1">{campaign.lastError}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => {
                const pendingSteps = pipelineStatus?.pendingSteps;
                if (pendingSteps && pendingSteps.length > 0) handleRunStep(pendingSteps[0] as StepKey);
              }}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabs for different sections */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="credibility">Credibility</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="rankings">Rankings</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        {/* ─── CREDIBILITY TAB ─── */}
        <TabsContent value="credibility" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Business Credibility Facts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Years in Business</h4>
                  <p className="text-sm text-foreground">{(campaign as any).business?.yearsInBusiness || "Not specified"}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">BBB Rating</h4>
                  <p className="text-sm text-foreground">{(campaign as any).business?.bbbRating || "Not specified"}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Certifications</h4>
                  <p className="text-sm text-foreground">{(campaign as any).business?.certifications || "Not specified"}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Licenses</h4>
                  <p className="text-sm text-foreground">{(campaign as any).business?.licenses || "Not specified"}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Awards</h4>
                  <p className="text-sm text-foreground">{(campaign as any).business?.awards || "Not specified"}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Warranties</h4>
                  <p className="text-sm text-foreground">{(campaign as any).business?.warranties || "Not specified"}</p>
                </div>
              </div>
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-sm font-medium text-muted-foreground">Key Differentiators</h4>
                <p className="text-sm text-foreground">{(campaign as any).business?.differentiators || "Not specified"}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── OVERVIEW TAB ─── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Campaign Info */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Campaign Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Business</span>
                  <span className="text-foreground font-medium">{(campaign as any).businessName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Package</span>
                  <span className="text-foreground">{campaign.clientType?.replace(/_/g, " ") || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Queries</span>
                  <span className="text-foreground">{queryLocations?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Error Count</span>
                  <span className={`font-medium ${(campaign.errorCount || 0) > 0 ? "text-destructive" : "text-foreground"}`}>
                    {campaign.errorCount || 0}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Training Mode */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-primary" />
                  Training Mode
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Current Mode</span>
                  <Badge variant="outline" className={modeColors[campaign.trainingAggressiveness || "aggressive"] || ""}>
                    {campaign.trainingAggressiveness || "aggressive"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Rank Checks</span>
                  <span className="text-sm text-foreground">{campaign.rankCheckFrequency || "daily"}</span>
                </div>
                {modeRecommendation && modeRecommendation.recommendedMode !== campaign.trainingAggressiveness && (
                  <div className="p-2 rounded-md bg-primary/5 border border-primary/20">
                    <p className="text-xs text-primary">
                      Recommended: <strong>{modeRecommendation.recommendedMode}</strong>
                      {" — "}{modeRecommendation.reason}
                    </p>
                  </div>
                )}
                <Dialog open={showModeDialog} onOpenChange={setShowModeDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full">
                      <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                      Change Mode
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Change Training Mode</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <Select value={selectedMode} onValueChange={setSelectedMode}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="aggressive">Aggressive (3/day, 10 iterations)</SelectItem>
                          <SelectItem value="moderate">Moderate (1/day, 5 iterations)</SelectItem>
                          <SelectItem value="maintenance">Maintenance (1/week, 3 iterations)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        className="w-full"
                        disabled={!selectedMode || applyModeMutation.isPending}
                        onClick={() => {
                          if (selectedMode) {
                            applyModeMutation.mutate({
                              campaignId,
                              mode: selectedMode as any,
                              reason: "Manual override from admin dashboard",
                            });
                          }
                        }}
                      >
                        {applyModeMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : null}
                        Apply Mode Change
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            {/* Enrichment Status */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Training Enrichment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Level</span>
                  <Badge
                    variant="outline"
                    className={
                      enrichmentStatus?.enrichmentLevel === "full"
                        ? "bg-green-500/10 text-green-400 border-green-500/30"
                        : enrichmentStatus?.enrichmentLevel === "moderate"
                        ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                        : enrichmentStatus?.enrichmentLevel === "basic"
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {enrichmentStatus?.enrichmentLevel || "none"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credibility Facts</span>
                  <span className="text-foreground">{enrichmentStatus?.credibilityFactCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Published Pages</span>
                  <span className="text-foreground">{enrichmentStatus?.publishedPageCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">llm.txt</span>
                  <span className={enrichmentStatus?.hasLlmTxt ? "text-green-400" : "text-muted-foreground"}>
                    {enrichmentStatus?.hasLlmTxt ? "Published" : "Not yet"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Wins */}
          {wins && wins.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-400" />
                  Recent Wins ({wins.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {wins.slice(0, 5).map((win: any, i: number) => {
                    // Determine which screenshots to show based on platform
                    const beforeShot = win.platform === "chatgpt" ? win.beforeScreenshotChatgpt
                      : win.platform === "ai_overview" ? win.beforeScreenshotGoogleAi
                      : win.beforeScreenshotChatgpt || win.beforeScreenshotGoogleAi;
                    const afterShot = win.platform === "chatgpt" ? win.afterScreenshotChatgpt
                      : win.platform === "ai_overview" ? win.afterScreenshotGoogleAi
                      : win.afterScreenshotChatgpt || win.afterScreenshotGoogleAi;
                    const beforeVideo = win.platform === "chatgpt" ? win.beforeVideoChatgpt
                      : win.platform === "ai_overview" ? win.beforeVideoGoogleAi
                      : win.beforeVideoChatgpt || win.beforeVideoGoogleAi;
                    const afterVideo = win.platform === "chatgpt" ? win.afterVideoChatgpt
                      : win.platform === "ai_overview" ? win.afterVideoGoogleAi
                      : win.afterVideoChatgpt || win.afterVideoGoogleAi;
                    const hasEvidence = beforeShot || afterShot || beforeVideo || afterVideo;
                    return (
                      <div key={i} className="rounded-md bg-muted/30 overflow-hidden">
                        <div className="flex items-center gap-3 p-2">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            win.significance === "breakthrough" ? "bg-yellow-500/20" :
                            win.significance === "major" ? "bg-green-500/20" :
                            "bg-blue-500/20"
                          }`}>
                            <Trophy className={`w-4 h-4 ${
                              win.significance === "breakthrough" ? "text-yellow-400" :
                              win.significance === "major" ? "text-green-400" :
                              "text-blue-400"
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground">{win.description}</p>
                            <p className="text-xs text-muted-foreground">{win.platform} — {win.query} — {win.location}</p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {win.significance}
                          </Badge>
                        </div>
                        {hasEvidence && (
                          <div className="px-3 pb-3">
                            <p className="text-xs text-muted-foreground mb-2 font-medium">Before / After Recording</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground text-center">Before</p>
                                {beforeShot ? (
                                  <a href={beforeShot} target="_blank" rel="noopener noreferrer">
                                    <img src={beforeShot} alt="Before recording thumbnail" className="w-full rounded border border-border object-cover max-h-40 hover:opacity-80 transition-opacity" />
                                  </a>
                                ) : beforeVideo ? (
                                  <video src={beforeVideo} controls className="w-full rounded border border-border max-h-40" />
                                ) : (
                                  <div className="w-full h-24 rounded border border-dashed border-border flex items-center justify-center">
                                    <p className="text-xs text-muted-foreground">Pending capture</p>
                                  </div>
                                )}
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground text-center">After</p>
                                {afterShot ? (
                                  <a href={afterShot} target="_blank" rel="noopener noreferrer">
                                    <img src={afterShot} alt="After recording thumbnail" className="w-full rounded border border-green-500/30 object-cover max-h-40 hover:opacity-80 transition-opacity" />
                                  </a>
                                ) : afterVideo ? (
                                  <video src={afterVideo} controls className="w-full rounded border border-green-500/30 max-h-40" />
                                ) : (
                                  <div className="w-full h-24 rounded border border-dashed border-green-500/30 flex items-center justify-center">
                                    <p className="text-xs text-muted-foreground">Captured on next check</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Query Locations */}
          {queryLocations && queryLocations.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                  <Search className="w-4 h-4 text-primary" />
                  Query × Location Combos ({queryLocations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {queryLocations.map((ql: any) => (
                    <div key={ql.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-sm">
                      <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-foreground truncate flex-1">{ql.searchQuery}</span>
                      <span className="text-muted-foreground text-xs shrink-0">• {ql.location}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── TRAINING TAB ─── */}
        <TabsContent value="training" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Schedule Config */}
            {scheduleStatus && (
              <Card className="bg-card border-border md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-card-foreground">Schedule Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-md bg-muted/30">
                      <p className="text-xs text-muted-foreground">Current Mode</p>
                      <p className="text-foreground font-medium capitalize">{scheduleStatus.currentMode}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30">
                      <p className="text-xs text-muted-foreground">Recommended Mode</p>
                      <p className="text-foreground font-medium capitalize">{scheduleStatus.recommendedMode}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30">
                      <p className="text-xs text-muted-foreground">Visibility Score</p>
                      <p className="text-foreground font-medium">{scheduleStatus.currentVisibilityScore ?? "N/A"}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30">
                      <p className="text-xs text-muted-foreground">Score Trend</p>
                      <p className="text-foreground font-medium capitalize">{scheduleStatus.scoreTrend}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30">
                      <p className="text-xs text-muted-foreground">Auto-Recovery</p>
                      <p className={`font-medium ${scheduleStatus.autoRecoveryTriggered ? "text-orange-400" : "text-foreground"}`}>
                        {scheduleStatus.autoRecoveryTriggered ? "Triggered" : "Normal"}
                      </p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30">
                      <p className="text-xs text-muted-foreground">Campaign Age</p>
                      <p className="text-foreground font-medium">{scheduleStatus.daysSinceCreation} days</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Mode Recommendation */}
            {modeRecommendation && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-card-foreground">AI Recommendation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-center p-4 rounded-lg bg-muted/30">
                    <Badge variant="outline" className={`text-lg px-4 py-1 ${modeColors[modeRecommendation.recommendedMode] || ""}`}>
                      {modeRecommendation.recommendedMode}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-2">{modeRecommendation.reason}</p>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Score</span>
                      <span className="text-foreground">{modeRecommendation.currentScore ?? "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Trend</span>
                      <span className="flex items-center gap-1 text-foreground">
                        {modeRecommendation.trend === "improving" ? (
                          <TrendingUp className="w-3 h-3 text-green-400" />
                        ) : modeRecommendation.trend === "declining" ? (
                          <TrendingDown className="w-3 h-3 text-red-400" />
                        ) : (
                          <Minus className="w-3 h-3 text-muted-foreground" />
                        )}
                        {modeRecommendation.trend}
                      </span>
                    </div>
                  </div>
                  {modeRecommendation.recommendedMode !== campaign.trainingAggressiveness && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        applyModeMutation.mutate({
                          campaignId,
                          mode: modeRecommendation.recommendedMode as any,
                          reason: modeRecommendation.reason,
                        });
                      }}
                      disabled={applyModeMutation.isPending}
                    >
                      Apply Recommendation
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Enrichment Details */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Training Context Enrichment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className="text-2xl font-bold text-foreground">{enrichmentStatus?.credibilityFactCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Credibility Facts</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className="text-2xl font-bold text-foreground">{enrichmentStatus?.publishedPageCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Published Pages</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className={`text-2xl font-bold ${enrichmentStatus?.hasLlmTxt ? "text-green-400" : "text-muted-foreground"}`}>
                    {enrichmentStatus?.hasLlmTxt ? "✓" : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">llm.txt</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className={`text-2xl font-bold ${enrichmentStatus?.hasCredibility ? "text-green-400" : "text-muted-foreground"}`}>
                    {enrichmentStatus?.hasCredibility ? "✓" : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Credibility</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── RANKINGS TAB ─── */}
        <TabsContent value="rankings" className="space-y-4">
          {rankReport ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-card border-border">
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-foreground">{rankReport.currentScore?.overall ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">Current Visibility Score</p>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-muted-foreground">{rankReport.baselineScore?.overall ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">Baseline Score</p>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="p-4 text-center">
                    {(() => {
                      const change = rankReport.currentScore && rankReport.baselineScore
                        ? rankReport.currentScore.overall - rankReport.baselineScore.overall
                        : null;
                      return (
                        <p className={`text-3xl font-bold ${
                          (change ?? 0) > 0 ? "text-green-400" :
                          (change ?? 0) < 0 ? "text-red-400" :
                          "text-muted-foreground"
                        }`}>
                          {change != null ? (change > 0 ? "+" : "") + Math.round(change) : "—"}
                        </p>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground">Score Change</p>
                  </CardContent>
                </Card>
              </div>

              {/* Query Details with Mention History */}
              {rankReport.queryDetails && rankReport.queryDetails.length > 0 && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-card-foreground">Query Rankings</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {rankReport.queryDetails.map((qd: any, i: number) => (
                        <QueryRankRow key={i} qd={qd} campaignId={campaignId} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="bg-card border-border">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="w-10 h-10 text-muted-foreground mb-3" />
                <h3 className="text-lg font-semibold text-foreground mb-1">No rank data yet</h3>
                <p className="text-sm text-muted-foreground">
                  Run a baseline check or rank tracking to see visibility scores.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => handleRunStep("baseline_check")}
                  disabled={!!runningStep}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Run Baseline Check
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── CONTENT TAB ─── */}
        <TabsContent value="content" className="space-y-4">
          <ContentTab campaignId={campaignId} />
        </TabsContent>

        {/* ─── WEBHOOKS TAB ─── */}
        <TabsContent value="webhooks" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Webhook Endpoint
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted/30">
                <code className="text-sm text-foreground flex-1 break-all">
                  POST {window.location.origin}/api/webhooks/onboarding
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/onboarding`);
                    toast.success("Copied!");
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Webhook Logs */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-card-foreground">Recent Webhook Logs</CardTitle>
            </CardHeader>
            <CardContent>
              {webhookLogs && webhookLogs.length > 0 ? (
                <div className="space-y-2">
                  {webhookLogs.map((log: any) => (
                    <div key={log.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30 text-sm">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        log.status === "processed" ? "bg-green-400" :
                        log.status === "error" ? "bg-red-400" :
                        "bg-yellow-400"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground truncate">{log.source || "webhook"}</p>
                        <p className="text-xs text-muted-foreground">{log.errorMessage || "Processed successfully"}</p>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(log.receivedAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">No webhook logs yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Separate component for content tab to keep things clean
function ContentTab({ campaignId }: { campaignId: number }) {
  const utils = trpc.useUtils();
  const { data: contentPages, isLoading, previousData } = trpc.campaign.getContentPages.useQuery(
    { campaignId },
    {
      enabled: !!campaignId,
      refetchInterval: (query) => {
        // Poll every 5s while content is still being generated
        const pages = query.state.data;
        if (!pages || pages.length === 0) return 5000;
        return false;
      },
    }
  );
  const { data: credData } = trpc.campaign.getCredibilityData.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  const [urlInputs, setUrlInputs] = useState<Record<number, string>>({});
  const [expandedPages, setExpandedPages] = useState<Record<number, boolean>>({});
  const [toastFired, setToastFired] = useState(false);

  // Fire a toast the first time generated pages arrive
  const prevCount = previousData?.length ?? 0;
  const currentCount = contentPages?.length ?? 0;
  if (!toastFired && prevCount === 0 && currentCount > 0) {
    const pageCount = contentPages!.filter((p: any) => p.pageType !== "llm_txt").length;
    toast.success(`📄 ${pageCount} content page${pageCount !== 1 ? "s" : ""} ready — go to the Content tab to copy them in.`, {
      duration: 8000,
    });
    setToastFired(true);
  }

  const setContentPageUrl = trpc.campaign.setContentPageUrl.useMutation({
    onSuccess: (data) => {
      utils.campaign.getContentPages.invalidate({ campaignId });
      if (data.allUrlsEntered) {
        toast.success("✅ All URLs saved — indexing started automatically.");
      } else {
        toast.success("URL saved.");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const visiblePages = contentPages?.filter((p: any) => p.pageType !== "llm_txt" && p.pageType !== "schema_package") ?? [];
  const llmTxtPage = contentPages?.find((p: any) => p.pageType === "llm_txt");
  const schemaPackagePage = contentPages?.find((p: any) => p.pageType === "schema_package");
  const allUrlsEntered = visiblePages.length > 0 && visiblePages.every((p: any) => !!p.publishedUrl);

  return (
    <div className="space-y-4">
      {/* Credibility Data Summary */}
      {credData && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-400" />
              Credibility Research
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="text-center p-3 rounded-lg bg-purple-500/10 min-w-[80px]">
                <p className="text-2xl font-bold text-purple-400">{credData.credibilityScore || "—"}</p>
                <p className="text-xs text-muted-foreground">Score</p>
              </div>
              <div className="flex-1 text-sm text-muted-foreground">
                <p>Research completed {credData.createdAt ? new Date(credData.createdAt).toLocaleDateString() : "N/A"}</p>
                {credData.researchResults ? <p className="text-green-400 text-xs mt-1">✓ llm.txt generated</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Workflow banner — shown when pages exist but not all URLs are saved */}
      {visiblePages.length > 0 && !allUrlsEntered && (
        <Card className="bg-indigo-500/10 border-indigo-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
              <div className="text-sm text-indigo-200">
                <p className="font-medium">Content ready — copy into the client's site</p>
                <p className="text-xs text-indigo-300/80 mt-0.5">
                  Each page below shows where it goes and has a Copy button. Paste the content into the client's site, then enter the live URL here. Indexing starts automatically once all URLs are saved.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All done banner */}
      {allUrlsEntered && (
        <Card className="bg-green-500/10 border-green-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
              <p className="text-sm text-green-300 font-medium">All pages published — indexing in progress.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content Pages */}
      {visiblePages.length > 0 ? (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              Credibility Pages ({visiblePages.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {visiblePages.map((page: any) => {
                const isExpanded = expandedPages[page.id] ?? false;
                const isNewPage = page.deliveryType === "new_page" || !page.deliveryType;
                return (
                  <div key={page.id} className="rounded-lg border border-border bg-muted/20">
                    {/* Page header row */}
                    <div className="flex items-center gap-3 p-3">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground font-medium truncate">{page.pageTitle}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-xs ${isNewPage ? "bg-blue-500/10 text-blue-400 border-blue-500/30" : "bg-orange-500/10 text-orange-400 border-orange-500/30"}`}
                          >
                            {isNewPage ? "New page" : "Add to existing"}
                          </Badge>
                          {page.pageSlug && <span className="text-xs text-muted-foreground">/{page.pageSlug}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {page.publishedUrl ? (
                          <>
                            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">
                              Published
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => window.open(page.publishedUrl, "_blank")}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                            Needs URL
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => setExpandedPages(prev => ({ ...prev, [page.id]: !isExpanded }))}
                        >
                          {isExpanded ? "Hide" : "View"}
                        </Button>
                      </div>
                    </div>

                    {/* Placement instructions */}
                    {page.placementInstructions && (
                      <div className="px-3 pb-2 flex items-start gap-2">
                        <ChevronRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-indigo-300">{page.placementInstructions}</p>
                      </div>
                    )}

                    {/* Expanded content + copy button */}
                    {isExpanded && (
                      <div className="border-t border-border mx-3 mb-3">
                        <div className="flex justify-end pt-2 pb-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                            onClick={() => {
                              navigator.clipboard.writeText(page.pageContent);
                              toast.success("Content copied to clipboard!");
                            }}
                          >
                            <Copy className="w-3 h-3" />
                            Copy content
                          </Button>
                        </div>
                        <div className="rounded-md bg-muted/40 p-3 max-h-72 overflow-y-auto">
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono break-words">
                            {page.pageContent}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* URL entry row — only shown for unpublished pages */}
                    {!page.publishedUrl && (
                      <div className="flex items-center gap-2 px-3 pb-3">
                        <Input
                          placeholder="https://client-site.com/page-slug"
                          value={urlInputs[page.id] ?? ""}
                          onChange={(e) => setUrlInputs(prev => ({ ...prev, [page.id]: e.target.value }))}
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs shrink-0"
                          disabled={!urlInputs[page.id] || setContentPageUrl.isPending}
                          onClick={() => {
                            const url = urlInputs[page.id];
                            if (!url) return;
                            setContentPageUrl.mutate({ pageId: page.id, publishedUrl: url });
                          }}
                        >
                          Save URL
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-1">No content pages yet</h3>
            <p className="text-sm text-muted-foreground">
              Run credibility research and content generation to create pages.
            </p>
          </CardContent>
        </Card>
      )}

      {/* llm.txt section */}
      {llmTxtPage && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-400" />
              llm.txt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Upload this file to the root of the client's website as <code className="text-teal-400">/llm.txt</code> so AI crawlers can read it directly.
              This file tells GPTBot, Claude-Web, Google-Extended, and other AI crawlers exactly who this business is, what they specialize in, and where to find their credibility pages.
            </p>
            <div className="flex justify-end mb-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(llmTxtPage.pageContent);
                  toast.success("llm.txt copied to clipboard!");
                }}
              >
                <Copy className="w-3 h-3" />
                Copy llm.txt
              </Button>
            </div>
            <div className="rounded-md bg-muted/40 p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono break-words">
                {llmTxtPage.pageContent}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Schema Markup Package */}
      {schemaPackagePage && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Code className="w-4 h-4 text-orange-400" />
              Schema Markup Package
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-1">
              Copy the <strong>SITE-WIDE SCHEMA</strong> block and paste it into the <code className="text-orange-400">&lt;head&gt;</code> of every page
              (use the <em>Insert Headers and Footers</em> plugin in WordPress). Each per-page block goes on its corresponding page.
            </p>
            {schemaPackagePage.placementInstructions && (
              <p className="text-xs text-orange-300/80 mb-3 bg-orange-500/10 rounded p-2">
                {schemaPackagePage.placementInstructions}
              </p>
            )}
            <div className="flex gap-2 justify-end mb-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  // Copy only the site-wide schema block
                  const match = schemaPackagePage.pageContent.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/);
                  const siteWide = match ? match[0] : schemaPackagePage.pageContent;
                  navigator.clipboard.writeText(siteWide);
                  toast.success("Site-wide schema copied!");
                }}
              >
                <Copy className="w-3 h-3" />
                Copy Site-Wide Schema
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(schemaPackagePage.pageContent);
                  toast.success("Full schema package copied!");
                }}
              >
                <Copy className="w-3 h-3" />
                Copy All
              </Button>
            </div>
            <div className="rounded-md bg-muted/40 p-3 max-h-64 overflow-y-auto">
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono break-words">
                {schemaPackagePage.pageContent}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── QueryRankRow — expandable row with mention history ───────────────────────
function QueryRankRow({ qd, campaignId }: { qd: any; campaignId: number }) {
  const [open, setOpen] = useState(false);

  const { data: history, isLoading } = trpc.rankTracking.getMentionHistory.useQuery(
    { queryLocationId: qd.queryLocationId, days: 90 },
    { enabled: open && !!qd.queryLocationId }
  );

  return (
    <div className="rounded-md bg-muted/30 text-sm overflow-hidden">
      {/* Main row */}
      <div className="flex items-center justify-between p-2">
        <div className="flex-1 min-w-0">
          <p className="text-foreground truncate">{qd.query}</p>
          <p className="text-xs text-muted-foreground">{qd.location}</p>
        </div>
        <div className="flex items-center gap-4 text-xs shrink-0">
          {qd.chatgpt && (
            <span className="text-blue-400">ChatGPT: {qd.chatgpt.mentioned ? "✓" : "—"}</span>
          )}
          {qd.gemini && (
            <span className="text-purple-400">Gemini: {qd.gemini.mentioned ? "✓" : "—"}</span>
          )}
          {qd.aiOverview && (
            <span className="text-green-400">AI Overview: {qd.aiOverview.mentioned ? "✓" : "—"}</span>
          )}
          {qd.queryLocationId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen((v) => !v)}
            >
              <History className="w-3 h-3 mr-1" />
              History
              {open ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
          )}
        </div>
      </div>

      {/* History panel */}
      {open && (
        <div className="border-t border-border/50 bg-muted/10 px-3 py-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading history…
            </div>
          ) : !history || history.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No history recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/30">
                    <th className="text-left py-1 pr-3 font-medium">Date</th>
                    <th className="text-left py-1 pr-3 font-medium">Type</th>
                    <th className="text-center py-1 pr-3 font-medium">ChatGPT</th>
                    <th className="text-center py-1 pr-3 font-medium">Gemini</th>
                    <th className="text-center py-1 font-medium">AI Overview</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row: any) => (
                    <tr key={row.id} className="border-b border-border/20 last:border-0">
                      <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">
                        {new Date(row.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="py-1 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          row.checkType === "training" ? "bg-blue-500/15 text-blue-400" :
                          row.checkType === "monitoring" ? "bg-purple-500/15 text-purple-400" :
                          row.checkType === "baseline" ? "bg-amber-500/15 text-amber-400" :
                          "bg-slate-500/15 text-slate-400"
                        }`}>
                          {row.checkType || "check"}
                        </span>
                      </td>
                      <td className="py-1 pr-3 text-center">
                        {row.chatgptMentioned
                          ? <span className="text-green-400 font-medium">✓</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1 pr-3 text-center">
                        {row.geminiMentioned
                          ? <span className="text-green-400 font-medium">✓</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1 text-center">
                        {row.aiOverviewMentioned
                          ? <span className="text-green-400 font-medium">✓</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
