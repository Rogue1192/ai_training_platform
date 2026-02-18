import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Plus, Calendar, Trash2, Clock, Play, RefreshCw, History, ChevronDown, ChevronUp, CheckCircle2, XCircle, SkipForward, AlertCircle, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIMEZONE_OPTIONS = [
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "UTC", label: "UTC" },
];

/** Convert full model name to a short readable label */
function getModelShortLabel(model: string): string {
  const map: Record<string, string> = {
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-3.5-turbo": "GPT-3.5",
    "claude-sonnet-4-20250514": "Claude Sonnet 4",
    "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
    "claude-3-haiku-20240307": "Claude 3 Haiku",
    "gemini-2.0-flash": "Gemini 2.0 Flash",
    "gemini-2.0-flash-exp": "Gemini 2.0 Flash",
    "gemini-1.5-pro": "Gemini 1.5 Pro",
    "gemini-1.5-flash": "Gemini 1.5 Flash",
  };
  return map[model] || model;
}

export default function ScheduledJobs() {
  const { data: jobs, isLoading, refetch } = trpc.schedule.list.useQuery();
  const { data: trainingSessions } = trpc.training.list.useQuery();
  const createJob = trpc.schedule.create.useMutation();
  const updateJob = trpc.schedule.update.useMutation();
  const deleteJob = trpc.schedule.delete.useMutation();
  const runNow = trpc.schedule.runNow.useMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [runningJobId, setRunningJobId] = useState<number | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"schedules" | "history">("schedules");
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [formData, setFormData] = useState({
    jobName: "",
    trainingSessionId: "",
    scheduleType: "daily" as "hourly" | "daily" | "weekly" | "monthly",
    timeOfDay: "09:00",
    dayOfWeek: "1", // Monday
    dayOfMonth: "1",
    timezone: "America/Los_Angeles",
    cronExpression: "",
  });

  const resetForm = () => {
    setFormData({
      jobName: "",
      trainingSessionId: "",
      scheduleType: "daily",
      timeOfDay: "09:00",
      dayOfWeek: "1",
      dayOfMonth: "1",
      timezone: "America/Los_Angeles",
      cronExpression: "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.jobName.trim()) {
      toast.error("Job name is required");
      return;
    }

    if (!formData.trainingSessionId) {
      toast.error("Please select a training session");
      return;
    }

    try {
      await createJob.mutateAsync({
        jobName: formData.jobName,
        trainingSessionId: parseInt(formData.trainingSessionId),
        scheduleType: formData.scheduleType,
        timeOfDay: formData.timeOfDay,
        dayOfWeek: formData.scheduleType === "weekly" ? parseInt(formData.dayOfWeek) : undefined,
        dayOfMonth: formData.scheduleType === "monthly" ? parseInt(formData.dayOfMonth) : undefined,
        timezone: formData.timezone,
        // cronExpression removed - using hourly/daily/weekly/monthly only
      });

      toast.success("Scheduled job created successfully");
      setIsDialogOpen(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to create scheduled job");
    }
  };

  const handleToggleActive = async (id: number, isActive: boolean) => {
    try {
      await updateJob.mutateAsync({ id, isActive: !isActive });
      toast.success(`Job ${!isActive ? "activated" : "deactivated"}`);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to update job");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this scheduled job?")) return;

    try {
      await deleteJob.mutateAsync({ id });
      toast.success("Scheduled job deleted");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete job");
    }
  };

  const handleRunNow = async (id: number) => {
    setRunningJobId(id);
    try {
      const result = await runNow.mutateAsync({ id });
      if (result.success) {
        toast.success("Training session started successfully");
        refetch();
      } else {
        toast.error(result.error || "Failed to run job");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to run job");
    } finally {
      setRunningJobId(null);
    }
  };

  const getScheduleDescription = (job: any) => {
    const time12h = formatTime12h(job.timeOfDay || "09:00");
    const tz = TIMEZONE_OPTIONS.find(t => t.value === job.timezone)?.label || job.timezone || "PT";

    switch (job.scheduleType) {
      case "daily":
        return `Every day at ${time12h} ${tz}`;
      case "weekly":
        const dayName = DAY_NAMES[job.dayOfWeek ?? 1];
        return `Every ${dayName} at ${time12h} ${tz}`;
      case "monthly":
        const day = job.dayOfMonth ?? 1;
        const suffix = getOrdinalSuffix(day);
        return `${day}${suffix} of every month at ${time12h} ${tz}`;
      case "hourly": {
        const [, mins] = job.timeOfDay.split(":").map(Number);
        if (mins > 0) return `Every hour at :${String(mins).padStart(2, "0")} past ${tz}`;
        return `Every hour on the hour ${tz}`;
      }
      default:
        return "Unknown schedule";
    }
  };

  const getTrainingSessionName = (sessionId: number | null) => {
    if (!sessionId || !trainingSessions) return "No session linked";
    const session = trainingSessions.find(s => s.id === sessionId);
    return session?.trainingName || "Unknown session";
  };

  const getNextRunDescription = (nextRun: Date | null) => {
    if (!nextRun) return "Not scheduled";

    const now = new Date();
    const next = new Date(nextRun);
    const diff = next.getTime() - now.getTime();

    if (diff < 0) return "Overdue";
    if (diff < 60 * 1000) return "In less than a minute";
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000));
      return `In ${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      return `In ${hours} hour${hours > 1 ? "s" : ""}`;
    }

    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `In ${days} day${days > 1 ? "s" : ""}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Scheduled Jobs</h1>
          <p className="text-muted-foreground mt-2">Automate recurring training sessions with exact scheduling</p>
        </div>
        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Schedule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle className="text-card-foreground">Create Scheduled Job</DialogTitle>
                <DialogDescription>Set up automated training runs with exact date and time</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="jobName">Job Name *</Label>
                  <Input
                    id="jobName"
                    value={formData.jobName}
                    onChange={(e) => setFormData({ ...formData, jobName: e.target.value })}
                    placeholder="e.g., Daily Titan Cleaning Training"
                    required
                    className="bg-background border-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trainingSessionId">Training Session *</Label>
                  <Popover open={sessionPickerOpen} onOpenChange={setSessionPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={sessionPickerOpen}
                        className="w-full justify-between bg-background border-input text-left font-normal h-auto min-h-10 py-2"
                      >
                        {formData.trainingSessionId ? (
                          (() => {
                            const selected = trainingSessions?.find(s => s.id.toString() === formData.trainingSessionId);
                            if (!selected) return "Select a training session";
                            const modelLabel = getModelShortLabel(selected.targetAiModel);
                            return (
                              <span className="flex items-center gap-2 truncate">
                                <Badge variant="secondary" className="text-xs shrink-0 font-mono">{modelLabel}</Badge>
                                <span className="truncate">{selected.trainingName}</span>
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-muted-foreground">Select a training session</span>
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search sessions..." />
                        <CommandList>
                          <CommandEmpty>No training sessions found.</CommandEmpty>
                          <CommandGroup>
                            {trainingSessions && trainingSessions.length > 0 ? (
                              trainingSessions.map((session) => {
                                const targetLabel = getModelShortLabel(session.targetAiModel);
                                const influencerLabel = getModelShortLabel(session.influencerAiModel);
                                return (
                                  <CommandItem
                                    key={session.id}
                                    value={`${session.trainingName} ${targetLabel} ${influencerLabel}`}
                                    onSelect={() => {
                                      setFormData({ ...formData, trainingSessionId: session.id.toString() });
                                      setSessionPickerOpen(false);
                                    }}
                                    className="flex items-center gap-2 py-2"
                                  >
                                    <Check
                                      className={`h-4 w-4 shrink-0 ${formData.trainingSessionId === session.id.toString() ? "opacity-100" : "opacity-0"}`}
                                    />
                                    <div className="flex flex-col gap-1 min-w-0">
                                      <span className="truncate font-medium">{session.trainingName}</span>
                                      <div className="flex gap-1.5">
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono shrink-0">
                                          Target: {targetLabel}
                                        </Badge>
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono shrink-0">
                                          Influencer: {influencerLabel}
                                        </Badge>
                                      </div>
                                    </div>
                                  </CommandItem>
                                );
                              })
                            ) : (
                              <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                                No training sessions available. Create one first.
                              </div>
                            )}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xs text-muted-foreground">
                    The training session that will be run on schedule
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Schedule Type *</Label>
                  <Select
                    value={formData.scheduleType}
                    onValueChange={(value: any) => setFormData({ ...formData, scheduleType: value })}
                  >
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                       <SelectItem value="daily">Daily</SelectItem>
                       <SelectItem value="weekly">Weekly</SelectItem>
                       <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Time of Day / Minutes past hour */}
                {formData.scheduleType === "hourly" ? (
                  <div className="space-y-2">
                    <Label htmlFor="minutesPast">Minutes Past the Hour</Label>
                    <Select
                      value={formData.timeOfDay.split(":")[1] || "00"}
                      onValueChange={(v) => setFormData({ ...formData, timeOfDay: `00:${v}` })}
                    >
                      <SelectTrigger className="bg-background border-input w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="00">:00 (on the hour)</SelectItem>
                        <SelectItem value="15">:15 (quarter past)</SelectItem>
                        <SelectItem value="30">:30 (half past)</SelectItem>
                        <SelectItem value="45">:45 (quarter to)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The training will run every hour at this minute mark
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="timeOfDay">Time of Day *</Label>
                    <Input
                      id="timeOfDay"
                      type="time"
                      value={formData.timeOfDay}
                      onChange={(e) => setFormData({ ...formData, timeOfDay: e.target.value })}
                      className="bg-background border-input w-40"
                    />
                    <p className="text-xs text-muted-foreground">
                      The exact time the training will run each scheduled day
                    </p>
                  </div>
                )}

                {/* Day of Week (for weekly) */}
                {formData.scheduleType === "weekly" && (
                  <div className="space-y-2">
                    <Label>Day of Week *</Label>
                    <Select
                      value={formData.dayOfWeek}
                      onValueChange={(value) => setFormData({ ...formData, dayOfWeek: value })}
                    >
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAY_NAMES.map((name, i) => (
                          <SelectItem key={i} value={i.toString()}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Day of Month (for monthly) */}
                {formData.scheduleType === "monthly" && (
                  <div className="space-y-2">
                    <Label>Day of Month *</Label>
                    <Select
                      value={formData.dayOfMonth}
                      onValueChange={(value) => setFormData({ ...formData, dayOfMonth: value })}
                    >
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <SelectItem key={d} value={d.toString()}>
                            {d}{getOrdinalSuffix(d)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Timezone */}
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select
                    value={formData.timezone}
                    onValueChange={(value) => setFormData({ ...formData, timezone: value })}
                  >
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Hourly schedules don't need time-of-day — only minutes past the hour */}

                {/* Schedule Preview */}
                <div className="bg-muted/50 rounded-lg p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">Schedule Preview</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {getScheduleDescription({
                      scheduleType: formData.scheduleType,
                      timeOfDay: formData.timeOfDay,
                      dayOfWeek: parseInt(formData.dayOfWeek),
                      dayOfMonth: parseInt(formData.dayOfMonth),
                      timezone: formData.timezone,
                      cronExpression: formData.cronExpression,
                    })}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createJob.isPending}>
                  {createJob.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Schedule"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("schedules")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "schedules"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Calendar className="w-4 h-4 inline mr-2" />
          Schedules ({jobs?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="w-4 h-4 inline mr-2" />
          Run History
        </button>
      </div>

      {activeTab === "schedules" && (
        <>
          {jobs && jobs.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Calendar className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No scheduled jobs yet</h3>
                <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                  Create automated training schedules to run training sessions at regular intervals.
                </p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Scheduled Job
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {jobs?.map((job) => (
                <ScheduleCard
                  key={job.id}
                  job={job}
                  isExpanded={expandedJobId === job.id}
                  onToggleExpand={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                  runningJobId={runningJobId}
                  onRunNow={handleRunNow}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                  getScheduleDescription={getScheduleDescription}
                  getTrainingSessionName={getTrainingSessionName}
                  getNextRunDescription={getNextRunDescription}
                />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "history" && <RunHistoryPanel />}
    </div>
  );
}

// Schedule Card Component
function ScheduleCard({
  job,
  isExpanded,
  onToggleExpand,
  runningJobId,
  onRunNow,
  onToggleActive,
  onDelete,
  getScheduleDescription,
  getTrainingSessionName,
  getNextRunDescription,
}: {
  job: any;
  isExpanded: boolean;
  onToggleExpand: () => void;
  runningJobId: number | null;
  onRunNow: (id: number) => void;
  onToggleActive: (id: number, isActive: boolean) => void;
  onDelete: (id: number) => void;
  getScheduleDescription: (job: any) => string;
  getTrainingSessionName: (id: number | null) => string;
  getNextRunDescription: (nextRun: Date | null) => string;
}) {
  const { data: runHistory } = trpc.schedule.getRunHistory.useQuery(
    { jobId: job.id },
    { enabled: isExpanded }
  );

  return (
    <Card className={`bg-card border-border ${!job.isActive ? "opacity-60" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <CardTitle className="text-card-foreground text-lg">{job.jobName}</CardTitle>
              <Badge variant={job.isActive ? "default" : "secondary"}>
                {job.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Training: <span className="text-foreground font-medium">{getTrainingSessionName(job.trainingSessionId)}</span>
            </p>
            <p className="text-sm text-primary font-medium mt-1">
              {getScheduleDescription(job)}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRunNow(job.id)}
              disabled={runningJobId === job.id}
            >
              {runningJobId === job.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Play className="w-4 h-4 mr-1" />
                  Run Now
                </>
              )}
            </Button>
            <div className="flex items-center gap-2">
              <Label htmlFor={`active-${job.id}`} className="sr-only">
                {job.isActive ? "Active" : "Inactive"}
              </Label>
              <Switch
                id={`active-${job.id}`}
                checked={job.isActive}
                onCheckedChange={() => onToggleActive(job.id, job.isActive)}
              />
            </div>
            <Button size="sm" variant="destructive" onClick={() => onDelete(job.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <RefreshCw className="w-4 h-4" />
              <span>Total Runs</span>
            </div>
            <p className="font-bold text-2xl text-foreground">{job.runCount}</p>
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="w-4 h-4" />
              <span>Next Run</span>
            </div>
            <p className="font-medium text-foreground">
              {job.isActive ? getNextRunDescription(job.nextRun) : "Paused"}
            </p>
            {job.nextRun && job.isActive && (
              <p className="text-xs text-muted-foreground">
                {new Date(job.nextRun).toLocaleString()}
              </p>
            )}
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Calendar className="w-4 h-4" />
              <span>Last Run</span>
            </div>
            <p className="font-medium text-foreground">
              {job.lastRun ? new Date(job.lastRun).toLocaleDateString() : "Never"}
            </p>
            {job.lastRun && (
              <p className="text-xs text-muted-foreground">
                {new Date(job.lastRun).toLocaleTimeString()}
              </p>
            )}
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="w-4 h-4" />
              <span>Time</span>
            </div>
            <p className="font-medium text-foreground">
              {formatTime12h(job.timeOfDay || "09:00")}
            </p>
            <p className="text-xs text-muted-foreground">
              {TIMEZONE_OPTIONS.find(t => t.value === job.timezone)?.label || job.timezone || "PT"}
            </p>
          </div>
        </div>

        {/* Expand for run history */}
        <button
          onClick={onToggleExpand}
          className="flex items-center gap-2 mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          <History className="w-4 h-4" />
          Run History
        </button>

        {isExpanded && (
          <div className="mt-3 border-t border-border pt-3">
            {!runHistory || runHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No runs recorded yet</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {runHistory.map((run: any) => (
                  <RunHistoryRow key={run.id} run={run} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Run History Row
function RunHistoryRow({ run }: { run: any }) {
  const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
    completed: { icon: CheckCircle2, color: "text-green-500", label: "Completed" },
    failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
    skipped: { icon: SkipForward, color: "text-yellow-500", label: "Skipped" },
    running: { icon: Loader2, color: "text-blue-500", label: "Running" },
  };

  const config = statusConfig[run.status] || statusConfig.running;
  const StatusIcon = config.icon;

  return (
    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-3">
        <StatusIcon className={`w-5 h-5 ${config.color} ${run.status === "running" ? "animate-spin" : ""}`} />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{config.label}</span>
            <Badge variant="outline" className="text-xs">
              {run.triggeredBy === "manual" ? "Manual" : "Scheduled"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(run.startedAt).toLocaleString()}
            {run.completedAt && ` — ${getRunDuration(run.startedAt, run.completedAt)}`}
          </p>
          {run.errorMessage && (
            <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {run.errorMessage}
            </p>
          )}
        </div>
      </div>
      <div className="text-right">
        {run.influenceScore !== null && run.influenceScore !== undefined && (
          <div className="text-sm">
            <span className="text-muted-foreground">Score: </span>
            <span className="font-bold text-foreground">{run.influenceScore}%</span>
          </div>
        )}
        {run.iterationsCompleted !== null && run.iterationsCompleted !== undefined && (
          <p className="text-xs text-muted-foreground">{run.iterationsCompleted} iterations</p>
        )}
      </div>
    </div>
  );
}

// Full Run History Panel
function RunHistoryPanel() {
  const { data: allRuns, isLoading } = trpc.schedule.getRunHistory.useQuery({});

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!allRuns || allRuns.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <History className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No run history yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Run history will appear here after your first scheduled or manual training run.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-card-foreground">All Run History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {allRuns.map((run: any) => (
            <div key={run.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-3">
                <RunStatusIcon status={run.status} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {run.jobName || `Job #${run.scheduledJobId}`}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {run.triggeredBy === "manual" ? "Manual" : "Scheduled"}
                    </Badge>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString()}
                    {run.completedAt && ` — ${getRunDuration(run.startedAt, run.completedAt)}`}
                  </p>
                  {run.errorMessage && (
                    <p className="text-xs text-red-400 mt-1">{run.errorMessage}</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                {run.influenceScore !== null && run.influenceScore !== undefined && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Score: </span>
                    <span className="font-bold text-foreground">{run.influenceScore}%</span>
                  </div>
                )}
                {run.baselineMentioned !== null && (
                  <p className="text-xs text-muted-foreground">
                    Baseline: {run.baselineMentioned ? "Mentioned" : "Not mentioned"}
                  </p>
                )}
                {run.evaluationMentioned !== null && (
                  <p className="text-xs text-muted-foreground">
                    Eval: {run.evaluationMentioned ? "Mentioned" : "Not mentioned"}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  const icons: Record<string, { icon: any; color: string }> = {
    completed: { icon: CheckCircle2, color: "text-green-500" },
    failed: { icon: XCircle, color: "text-red-500" },
    skipped: { icon: SkipForward, color: "text-yellow-500" },
    running: { icon: Loader2, color: "text-blue-500" },
  };
  const config = icons[status] || icons.running;
  const Icon = config.icon;
  return <Icon className={`w-5 h-5 ${config.color} ${status === "running" ? "animate-spin" : ""}`} />;
}

function RunStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default",
    failed: "destructive",
    skipped: "secondary",
    running: "outline",
  };
  return <Badge variant={variants[status] || "outline"} className="text-xs">{status}</Badge>;
}

function getRunDuration(start: string | Date, end: string | Date): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function formatTime12h(timeOfDay: string): string {
  const [h, m] = timeOfDay.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}
