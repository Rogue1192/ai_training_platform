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
import { Loader2, Plus, Calendar, Trash2, Clock, Play, RefreshCw } from "lucide-react";

export default function ScheduledJobs() {
  const { data: jobs, isLoading, refetch } = trpc.schedule.list.useQuery();
  const { data: trainingSessions } = trpc.training.list.useQuery();
  const createJob = trpc.schedule.create.useMutation();
  const updateJob = trpc.schedule.update.useMutation();
  const deleteJob = trpc.schedule.delete.useMutation();
  const runNow = trpc.schedule.runNow.useMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [runningJobId, setRunningJobId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    jobName: "",
    trainingSessionId: "",
    scheduleType: "daily" as "daily" | "weekly" | "monthly" | "custom",
    cronExpression: "",
  });

  const resetForm = () => {
    setFormData({
      jobName: "",
      trainingSessionId: "",
      scheduleType: "daily",
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
        cronExpression: formData.scheduleType === "custom" ? formData.cronExpression : undefined,
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

  const getScheduleLabel = (scheduleType: string) => {
    const labels: Record<string, string> = {
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      custom: "Custom",
    };
    return labels[scheduleType] || scheduleType;
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
          <p className="text-muted-foreground mt-2">Automate recurring training sessions</p>
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
                <DialogDescription>Set up automated training runs at specified intervals</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="jobName">Job Name *</Label>
                  <Input
                    id="jobName"
                    value={formData.jobName}
                    onChange={(e) => setFormData({ ...formData, jobName: e.target.value })}
                    placeholder="e.g., Daily HVAC Training"
                    required
                    className="bg-background border-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trainingSessionId">Training Session *</Label>
                  <Select
                    value={formData.trainingSessionId}
                    onValueChange={(value) => setFormData({ ...formData, trainingSessionId: value })}
                  >
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue placeholder="Select a training session" />
                    </SelectTrigger>
                    <SelectContent>
                      {trainingSessions && trainingSessions.length > 0 ? (
                        trainingSessions.map((session) => (
                          <SelectItem key={session.id} value={session.id.toString()}>
                            {session.trainingName}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                          No training sessions available. Create one first.
                        </div>
                      )}
                    </SelectContent>
                  </Select>
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
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="custom">Custom (Cron)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.scheduleType === "custom" && (
                  <div className="space-y-2">
                    <Label htmlFor="cronExpression">Cron Expression</Label>
                    <Input
                      id="cronExpression"
                      value={formData.cronExpression}
                      onChange={(e) => setFormData({ ...formData, cronExpression: e.target.value })}
                      placeholder="e.g., 0 9 * * * (every day at 9 AM)"
                      className="bg-background border-input"
                    />
                    <p className="text-xs text-muted-foreground">
                      Format: minute hour day month weekday (e.g., "0 9 * * *" for 9 AM daily)
                    </p>
                  </div>
                )}
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
            <Card key={job.id} className={`bg-card border-border ${!job.isActive ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <CardTitle className="text-card-foreground text-lg">{job.jobName}</CardTitle>
                      <Badge variant={job.isActive ? "default" : "secondary"}>
                        {job.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{getScheduleLabel(job.scheduleType)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Training: <span className="text-foreground font-medium">{getTrainingSessionName(job.trainingSessionId)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleRunNow(job.id)}
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
                      <Label htmlFor={`active-${job.id}`} className="text-sm text-muted-foreground sr-only">
                        {job.isActive ? "Active" : "Inactive"}
                      </Label>
                      <Switch
                        id={`active-${job.id}`}
                        checked={job.isActive}
                        onCheckedChange={() => handleToggleActive(job.id, job.isActive)}
                      />
                    </div>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(job.id)}>
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
                  
                  {job.cronExpression && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="text-muted-foreground mb-1">Cron</div>
                      <p className="font-mono text-sm text-foreground">{job.cronExpression}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
