import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Plus, Calendar, Trash2, Clock } from "lucide-react";

export default function ScheduledJobs() {
  const { data: jobs, isLoading, refetch } = trpc.schedule.list.useQuery();
  const { data: trainingSessions } = trpc.training.list.useQuery();
  const { data: businesses } = trpc.business.list.useQuery();
  const createJob = trpc.schedule.create.useMutation();
  const updateJob = trpc.schedule.update.useMutation();
  const deleteJob = trpc.schedule.delete.useMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    jobName: "",
    trainingSessionId: "",
    businessId: "",
    scheduleType: "daily" as "daily" | "weekly" | "monthly" | "custom",
    cronExpression: "",
  });

  const resetForm = () => {
    setFormData({
      jobName: "",
      trainingSessionId: "",
      businessId: "",
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

    if (!formData.trainingSessionId && !formData.businessId) {
      toast.error("Please select a training session or business");
      return;
    }

    try {
      await createJob.mutateAsync({
        jobName: formData.jobName,
        trainingSessionId: formData.trainingSessionId ? parseInt(formData.trainingSessionId) : undefined,
        businessId: formData.businessId ? parseInt(formData.businessId) : undefined,
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

  const getScheduleLabel = (scheduleType: string) => {
    const labels: Record<string, string> = {
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      custom: "Custom",
    };
    return labels[scheduleType] || scheduleType;
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
                  <Label htmlFor="trainingSessionId">Training Session</Label>
                  <Select
                    value={formData.trainingSessionId}
                    onValueChange={(value) => setFormData({ ...formData, trainingSessionId: value })}
                  >
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue placeholder="Select a training session" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {trainingSessions?.map((session) => (
                        <SelectItem key={session.id} value={session.id.toString()}>
                          {session.trainingName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="businessId">Business (Optional)</Label>
                  <Select value={formData.businessId} onValueChange={(value) => setFormData({ ...formData, businessId: value })}>
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue placeholder="Select a business" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {businesses?.map((business) => (
                        <SelectItem key={business.id} value={business.id.toString()}>
                          {business.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      placeholder="e.g., 0 0 * * * (every day at midnight)"
                      className="bg-background border-input"
                    />
                    <p className="text-xs text-muted-foreground">
                      Format: second minute hour day month weekday
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
            <Card key={job.id} className="bg-card border-border">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <CardTitle className="text-card-foreground">{job.jobName}</CardTitle>
                      <Badge variant={job.isActive ? "default" : "secondary"}>
                        {job.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{getScheduleLabel(job.scheduleType)}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`active-${job.id}`} className="text-sm text-muted-foreground">
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
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Schedule:</span>
                    <p className="font-medium text-foreground">{getScheduleLabel(job.scheduleType)}</p>
                  </div>
                  {job.cronExpression && (
                    <div>
                      <span className="text-muted-foreground">Cron:</span>
                      <p className="font-mono text-xs text-foreground">{job.cronExpression}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Run Count:</span>
                    <p className="font-medium text-foreground">{job.runCount}</p>
                  </div>
                  {job.lastRun && (
                    <div>
                      <span className="text-muted-foreground">Last Run:</span>
                      <p className="font-medium text-foreground">{new Date(job.lastRun).toLocaleString()}</p>
                    </div>
                  )}
                  {job.nextRun && (
                    <div>
                      <span className="text-muted-foreground">Next Run:</span>
                      <p className="font-medium text-foreground">{new Date(job.nextRun).toLocaleString()}</p>
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
