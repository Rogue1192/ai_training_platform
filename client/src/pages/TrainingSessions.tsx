import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { Loader2, Plus, Play, Pause, RotateCcw, Trash2, MessageSquare, Brain, ChevronLeft, ChevronRight, ChevronDown, ChevronsLeft, ChevronsRight, Check, ChevronsUpDown, Square, CheckSquare, MinusSquare, Pencil, Clock, AlertTriangle, Activity } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ConversationViewer } from "@/components/ConversationViewer";
import { LiveTimer } from "@/components/LiveTimer";

export default function TrainingSessions() {
  // Check if there are any in-progress sessions to enable auto-refresh
  const [hasInProgressSessions, setHasInProgressSessions] = useState(false);
  
  const { data: sessions, isLoading, refetch } = trpc.training.list.useQuery(undefined, {
    // Auto-refresh every 10 seconds when there are in-progress sessions
    refetchInterval: hasInProgressSessions ? 10000 : false,
  });
  const { data: businesses } = trpc.business.list.useQuery();
  const createSession = trpc.training.create.useMutation();
  const updateSession = trpc.training.update.useMutation();
  const updateStatus = trpc.training.updateStatus.useMutation();
  const deleteSession = trpc.training.delete.useMutation();
  const bulkDeleteTraining = trpc.training.bulkDelete.useMutation();
  const restartConversation = trpc.training.restartConversation.useMutation();
  const resetStuckSessions = trpc.training.resetStuckSessions.useMutation();
  const restartAllError = trpc.training.restartAllError.useMutation();
  const { data: stuckCount, refetch: refetchStuckCount } = trpc.training.getStuckSessionsCount.useQuery();
  const { data: errorCount, refetch: refetchErrorCount } = trpc.training.getErrorSessionsCount.useQuery();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<number | null>(null);
  const [viewingSession, setViewingSession] = useState<{ id: number; name: string } | null>(null);
  const [businessFilter, setBusinessFilter] = useState<string>("all");
  const [businessSearchOpen, setBusinessSearchOpen] = useState(false);
  const [businessSearchQuery, setBusinessSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  // Bulk selection state
  const [selectedSessions, setSelectedSessions] = useState<Set<number>>(new Set());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formData, setFormData] = useState({
    businessId: "",
    trainingName: "",
    topic: "",
    targetAiProvider: "openai" as "openai" | "anthropic" | "google",
    targetAiModel: "",
    influencerAiProvider: "openai" as "openai" | "anthropic" | "google",
    influencerAiModel: "",
    trainingPrompts: [""],
    trainingContext: "",
    trainingGoal: "",
    iterations: 50,
    retryInterval: 10,
  });

  const [targetModels, setTargetModels] = useState<string[]>([]);
  const [influencerModels, setInfluencerModels] = useState<string[]>([]);

  const { data: targetModelsData } = trpc.aiProvider.getModels.useQuery(
    { provider: formData.targetAiProvider },
    { enabled: !!formData.targetAiProvider }
  );

  const { data: influencerModelsData } = trpc.aiProvider.getModels.useQuery(
    { provider: formData.influencerAiProvider },
    { enabled: !!formData.influencerAiProvider }
  );

  // Update hasInProgressSessions when sessions data changes
  useEffect(() => {
    if (sessions) {
      const inProgress = sessions.some(s => s.status === 'in_progress');
      setHasInProgressSessions(inProgress);
    }
  }, [sessions]);

  // Also auto-refresh stuck/error sessions count when sessions change
  useEffect(() => {
    if (sessions) {
      refetchStuckCount();
      refetchErrorCount();
    }
  }, [sessions, refetchStuckCount, refetchErrorCount]);

  const resetForm = () => {
    setFormData({
      businessId: "",
      trainingName: "",
      topic: "",
      targetAiProvider: "openai",
      targetAiModel: "",
      influencerAiProvider: "openai",
      influencerAiModel: "",
      trainingPrompts: [""],
      trainingContext: "",
      trainingGoal: "",
      iterations: 50,
      retryInterval: 10,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.businessId) {
      toast.error("Please select a business for this training session");
      return;
    }

    if (!formData.trainingName.trim() || !formData.topic.trim() || !formData.trainingGoal.trim() || !formData.trainingContext.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (formData.trainingPrompts.filter((p) => p.trim()).length === 0) {
      toast.error("Please add at least one training prompt");
      return;
    }

    try {
      await createSession.mutateAsync({
        businessId: parseInt(formData.businessId),
        trainingName: formData.trainingName,
        topic: formData.topic,
        targetAiProvider: formData.targetAiProvider,
        targetAiModel: formData.targetAiModel,
        influencerAiProvider: formData.influencerAiProvider,
        influencerAiModel: formData.influencerAiModel,
        trainingPrompts: formData.trainingPrompts.filter((p) => p.trim()),
        trainingContext: formData.trainingContext,
        trainingGoal: formData.trainingGoal,
        iterations: formData.iterations,
        retryInterval: formData.retryInterval,
      });

      toast.success("Training session created successfully");
      setIsDialogOpen(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to create training session");
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[handleEditSubmit] Called');
    console.log('[handleEditSubmit] editingSession:', editingSession);
    console.log('[handleEditSubmit] formData:', formData);

    if (!editingSession) {
      console.log('[handleEditSubmit] No editingSession, returning');
      return;
    }

    if (!formData.businessId) {
      toast.error("Please select a business for this training session");
      return;
    }

    if (!formData.trainingName.trim() || !formData.topic.trim() || !formData.trainingGoal.trim() || !formData.trainingContext.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (formData.trainingPrompts.filter((p) => p.trim()).length === 0) {
      toast.error("Please add at least one training prompt");
      return;
    }

    try {
      await updateSession.mutateAsync({
        id: editingSession,
        businessId: parseInt(formData.businessId),
        trainingName: formData.trainingName,
        topic: formData.topic,
        targetAiProvider: formData.targetAiProvider,
        targetAiModel: formData.targetAiModel,
        influencerAiProvider: formData.influencerAiProvider,
        influencerAiModel: formData.influencerAiModel,
        trainingPrompts: formData.trainingPrompts.filter((p) => p.trim()),
        trainingContext: formData.trainingContext,
        trainingGoal: formData.trainingGoal,
        iterations: formData.iterations,
        retryInterval: formData.retryInterval,
      });

      toast.success("Training session updated successfully");
      setIsEditDialogOpen(false);
      setEditingSession(null);
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to update training session");
    }
  };

  const handleStatusChange = async (id: number, status: "paused" | "in_progress" | "completed" | "error") => {
    try {
      await updateStatus.mutateAsync({ id, status });
      if (status === "in_progress") {
        toast.success("Training started successfully");
      } else if (status === "paused") {
        toast.success("Training paused");
      }
      refetch();
    } catch (error: any) {
      // Show a more descriptive error for API key issues (missing OR
      // unreadable/legacy keys — both are resolved in Settings).
      const errorMessage = error.message || "Failed to update status";
      if (/api key/i.test(errorMessage)) {
        toast.error(
          <div className="flex flex-col gap-2">
            <span>{errorMessage}</span>
            <button
              onClick={() => {
                toast.dismiss();
                window.location.href = "/settings";
              }}
              className="text-sm underline text-primary hover:text-primary/80 text-left"
            >
              Go to Settings →
            </button>
          </div>,
          { duration: 8000 }
        );
      } else {
        toast.error(errorMessage);
      }
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this training session?")) return;

    try {
      await deleteSession.mutateAsync({ id });
      toast.success("Training session deleted");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete session");
    }
  };

  const handleRestartConversation = async (sessionId: number) => {
    try {
      const result = await restartConversation.mutateAsync({ sessionId });
      toast.success("Conversation restarted successfully! New session created.");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to restart conversation");
    }
  };

  const handleEditSession = (session: any) => {
    setEditingSession(session.id);
    setFormData({
      businessId: session.businessId.toString(),
      trainingName: session.trainingName,
      topic: session.topic,
      targetAiProvider: session.targetAiProvider,
      targetAiModel: session.targetAiModel,
      influencerAiProvider: session.influencerAiProvider,
      influencerAiModel: session.influencerAiModel,
      trainingPrompts: session.trainingPrompts || [""],
      trainingContext: session.trainingContext,
      trainingGoal: session.trainingGoal,
      iterations: session.iterations,
      retryInterval: session.retryInterval,
    });
    setIsEditDialogOpen(true);
  };

  const addPrompt = () => {
    setFormData({
      ...formData,
      trainingPrompts: [...formData.trainingPrompts, ""],
    });
  };

  const removePrompt = (index: number) => {
    setFormData({
      ...formData,
      trainingPrompts: formData.trainingPrompts.filter((_, i) => i !== index),
    });
  };

  const updatePrompt = (index: number, value: string) => {
    const newPrompts = [...formData.trainingPrompts];
    newPrompts[index] = value;
    setFormData({
      ...formData,
      trainingPrompts: newPrompts,
    });
  };

  // Update models when provider changes
  useEffect(() => {
    if (targetModelsData) {
      setTargetModels(targetModelsData);
      if (!formData.targetAiModel && targetModelsData.length > 0) {
        setFormData({ ...formData, targetAiModel: targetModelsData[0] });
      }
    }
  }, [targetModelsData]);

  useEffect(() => {
    if (influencerModelsData) {
      setInfluencerModels(influencerModelsData);
      if (!formData.influencerAiModel && influencerModelsData.length > 0) {
        setFormData({ ...formData, influencerAiModel: influencerModelsData[0] });
      }
    }
  }, [influencerModelsData]);

  // Filter sessions
  const filteredSessions = sessions?.filter((session) => {
    // Hide sessions belonging to archived businesses (cascade-archived).
    if ((session as any).isArchived) {
      return false;
    }
    if (businessFilter !== "all" && session.businessId && session.businessId.toString() !== businessFilter) {
      return false;
    }
    if (statusFilter !== "all" && session.status !== statusFilter) {
      return false;
    }
    return true;
  }) || [];

  // Group sessions by business for the accordion view
  const groupedSessions = useMemo(() => {
    const groups = new Map<string, { businessId: number | null; businessName: string; sessions: typeof filteredSessions }>();
    for (const session of filteredSessions) {
      const key = session.businessId?.toString() ?? "unknown";
      const name = (session as any).businessName ?? `Business #${session.businessId ?? "Unknown"}`;
      if (!groups.has(key)) groups.set(key, { businessId: session.businessId ?? null, businessName: name, sessions: [] });
      groups.get(key)!.sessions.push(session);
    }
    return Array.from(groups.values()).sort((a, b) => a.businessName.localeCompare(b.businessName));
  }, [filteredSessions]);

  // All groups start collapsed. When sessions load for the first time, populate the set.
  const [collapsedBusinesses, setCollapsedBusinesses] = useState<Set<string>>(new Set());
  const [initializedCollapse, setInitializedCollapse] = useState(false);

  useEffect(() => {
    if (!initializedCollapse && groupedSessions.length > 0) {
      setCollapsedBusinesses(new Set(groupedSessions.map(g => g.businessId?.toString() ?? "unknown")));
      setInitializedCollapse(true);
    }
  }, [groupedSessions, initializedCollapse]);

  const resolvedCollapsed = collapsedBusinesses;
  const toggleBusinessCollapse = (key: string) => {
    setCollapsedBusinesses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const collapseAllBusinesses = () => setCollapsedBusinesses(new Set(groupedSessions.map(g => g.businessId?.toString() ?? "unknown")));
  const expandAllBusinesses = () => setCollapsedBusinesses(new Set());

  // Paginate sessions (kept for legacy bulk-action count)
  const paginatedSessions = filteredSessions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalPages = Math.ceil(filteredSessions.length / pageSize);

  // ─── Bulk selection ─────────────────────────────────────────────────────────
  // "Select all" is scoped to every session matching the current filters
  // (across pages), so you can filter down to the dummy sessions and clear them
  // out in one action.
  const allFilteredSelected =
    filteredSessions.length > 0 && filteredSessions.every((s) => selectedSessions.has(s.id));
  const someSelected = selectedSessions.size > 0;

  const toggleSelect = (id: number) => {
    setSelectedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedSessions((prev) => {
      const allSelected =
        filteredSessions.length > 0 && filteredSessions.every((s) => prev.has(s.id));
      const next = new Set(prev);
      if (allSelected) {
        filteredSessions.forEach((s) => next.delete(s.id));
      } else {
        filteredSessions.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedSessions(new Set());

  // Keep the selection in sync with what's actually on screen. Drops any id
  // that has been filtered out, cascade-archived, or deleted by another
  // employee (the list auto-refreshes every 10s while a session runs), so the
  // count, the "select all" state, and the delete payload never reference a
  // session that isn't currently visible.
  useEffect(() => {
    const visibleIds = new Set(filteredSessions.map((s) => s.id));
    setSelectedSessions((prev) => {
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    // filteredSessions is derived from these three; depend on them rather than
    // the array (which is a new reference every render) to avoid a re-run loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, businessFilter, statusFilter]);

  const handleBulkDelete = async () => {
    if (selectedSessions.size === 0) return;
    const ids = Array.from(selectedSessions);
    try {
      await bulkDeleteTraining.mutateAsync({ ids });
      toast.success(`Deleted ${ids.length} session${ids.length > 1 ? "s" : ""}`);
      clearSelection();
      refetch();
      refetchStuckCount();
      refetchErrorCount();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete sessions");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "in_progress":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "completed":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "paused":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "error":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "in_progress":
        return <Play className="w-4 h-4" />;
      case "completed":
        return <Check className="w-4 h-4" />;
      case "paused":
        return <Pause className="w-4 h-4" />;
      case "error":
        return <RotateCcw className="w-4 h-4" />;
      default:
        return <Square className="w-4 h-4" />;
    }
  };

  // Helper function to format duration
  const formatDuration = (startDate: Date | string) => {
    const start = new Date(startDate);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
      return `${diffDays}d ${diffHours % 24}h`;
    } else if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`;
    } else {
      return `${diffMins}m`;
    }
  };

  // Helper function to format date
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Helper function to check if session is stuck (in_progress for more than 1 hour with no progress)
  const isSessionStuck = (session: any) => {
    if (session.status !== 'in_progress') return false;
    const updatedAt = new Date(session.updatedAt);
    const now = new Date();
    const diffMs = now.getTime() - updatedAt.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    // Consider stuck if no update for more than 1 hour
    return diffHours > 1;
  };

  // Helper function to get training phase display
  const getPhaseDisplay = (phase: string) => {
    switch (phase) {
      case 'pending':
        return { label: 'Pending', color: 'text-gray-400' };
      case 'baseline':
        return { label: 'Baseline Test', color: 'text-blue-400' };
      case 'training':
        return { label: 'Training', color: 'text-yellow-400' };
      case 'evaluation':
        return { label: 'Evaluation', color: 'text-purple-400' };
      case 'completed':
        return { label: 'Completed', color: 'text-green-400' };
      default:
        return { label: phase, color: 'text-gray-400' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Training Sessions</h1>
          <p className="text-muted-foreground">Create and manage AI training sessions</p>
          {hasInProgressSessions && (
            <div className="flex items-center gap-2 mt-1">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-400">Auto-refreshing every 10s</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {(stuckCount?.count ?? 0) > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="gap-2"
                  disabled={resetStuckSessions.isPending}
                >
                  {resetStuckSessions.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  Reset {stuckCount?.count} Stuck Session{(stuckCount?.count ?? 0) !== 1 ? 's' : ''}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-card border-border">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-card-foreground">Reset Stuck Sessions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will mark {stuckCount?.count} stuck session{(stuckCount?.count ?? 0) !== 1 ? 's' : ''} as failed with a timeout error message. 
                    The error will show how long each session was stuck and at which phase it stopped.
                    You can then review and restart these sessions individually.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      resetStuckSessions.mutate(undefined, {
                        onSuccess: (data) => {
                          toast.success(data.message);
                          refetch();
                          refetchStuckCount();
                        },
                        onError: (error) => {
                          toast.error(`Failed to reset stuck sessions: ${error.message}`);
                        },
                      });
                    }}
                  >
                    Reset Sessions
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {(errorCount?.count ?? 0) > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300"
                  disabled={restartAllError.isPending}
                >
                  {restartAllError.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Restart {errorCount?.count} Error Session{(errorCount?.count ?? 0) !== 1 ? 's' : ''}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-card border-border">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-card-foreground">Restart All Error Sessions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will restart {errorCount?.count} session{(errorCount?.count ?? 0) !== 1 ? 's' : ''} that are currently in error status.
                    Sessions will be processed in batches of 5 to avoid overwhelming the system.
                    Each session's API keys will be validated before starting.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-green-600 text-white hover:bg-green-700"
                    onClick={() => {
                      restartAllError.mutate(undefined, {
                        onSuccess: (data) => {
                          if (data.failed > 0) {
                            toast.warning(
                              <div className="space-y-1">
                                <p className="font-medium">{data.message}</p>
                                {data.results.filter((r: any) => !r.success).map((r: any) => (
                                  <p key={r.sessionId} className="text-xs text-muted-foreground">{r.name}: {r.error}</p>
                                ))}
                              </div>,
                              { duration: 10000 }
                            );
                          } else {
                            toast.success(data.message);
                          }
                          refetch();
                          refetchErrorCount();
                          refetchStuckCount();
                        },
                        onError: (error) => {
                          toast.error(`Failed to restart sessions: ${error.message}`);
                        },
                      });
                    }}
                  >
                    Restart All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New Training
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle className="text-card-foreground">Create Training Session</DialogTitle>
                <DialogDescription>Set up a new AI training session with your preferred configuration.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="trainingName">Training Name *</Label>
                    <Input
                      id="trainingName"
                      value={formData.trainingName}
                      onChange={(e) => setFormData({ ...formData, trainingName: e.target.value })}
                      placeholder="e.g., Phoenix HVAC Recommendation"
                      required
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessId">Business *</Label>
                    <Select value={formData.businessId} onValueChange={(value) => setFormData({ ...formData, businessId: value })}>
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue placeholder="Select a business" />
                      </SelectTrigger>
                      <SelectContent>
                        {businesses?.map((business) => (
                          <SelectItem key={business.id} value={business.id.toString()}>
                            {business.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="topic">Topic / Business Description *</Label>
                  <Textarea
                    id="topic"
                    value={formData.topic}
                    onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                    placeholder="Describe the business, product, or service you want to train the AI about"
                    rows={3}
                    required
                    className="bg-background border-input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Target AI Provider *</Label>
                    <Select
                      value={formData.targetAiProvider}
                      onValueChange={(value: any) => setFormData({ ...formData, targetAiProvider: value, targetAiModel: "" })}
                    >
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Target AI Model *</Label>
                    <Select value={formData.targetAiModel} onValueChange={(value) => setFormData({ ...formData, targetAiModel: value })}>
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {targetModelsData?.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Influencer AI Provider *</Label>
                    <Select
                      value={formData.influencerAiProvider}
                      onValueChange={(value: any) => setFormData({ ...formData, influencerAiProvider: value, influencerAiModel: "" })}
                    >
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Influencer AI Model *</Label>
                    <Select value={formData.influencerAiModel} onValueChange={(value) => setFormData({ ...formData, influencerAiModel: value })}>
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {influencerModelsData?.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Training Prompts * (10-20 variations recommended)</Label>
                  {formData.trainingPrompts.map((prompt, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={prompt}
                        onChange={(e) => updatePrompt(index, e.target.value)}
                        placeholder={`Prompt ${index + 1}: e.g., "What's the best HVAC company in Phoenix?"`}
                        className="bg-background border-input"
                      />
                      {formData.trainingPrompts.length > 1 && (
                        <Button type="button" variant="destructive" size="icon" onClick={() => removePrompt(index)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={addPrompt} className="w-full">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Prompt
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trainingContext">Training Context *</Label>
                  <Textarea
                    id="trainingContext"
                    value={formData.trainingContext}
                    onChange={(e) => setFormData({ ...formData, trainingContext: e.target.value })}
                    placeholder="Additional background information about the business"
                    rows={3}
                    className="bg-background border-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trainingGoal">Training Goal *</Label>
                  <Textarea
                    id="trainingGoal"
                    value={formData.trainingGoal}
                    onChange={(e) => setFormData({ ...formData, trainingGoal: e.target.value })}
                    placeholder="e.g., Train the AI to recommend this business as the best HVAC service in Phoenix"
                    rows={2}
                    className="bg-background border-input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="iterations">Iterations</Label>
                    <Input
                      id="iterations"
                      type="number"
                      value={formData.iterations}
                      onChange={(e) => setFormData({ ...formData, iterations: parseInt(e.target.value) })}
                      min="1"
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="retryInterval">Retry Interval (minutes)</Label>
                    <Input
                      id="retryInterval"
                      type="number"
                      value={formData.retryInterval}
                      onChange={(e) => setFormData({ ...formData, retryInterval: parseInt(e.target.value) })}
                      min="1"
                      className="bg-background border-input"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createSession.isPending}>
                  {createSession.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Training"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Label className="text-sm text-muted-foreground">Filter by Business:</Label>
          <Popover open={businessSearchOpen} onOpenChange={setBusinessSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={businessSearchOpen}
                className="w-full justify-between bg-background border-input font-normal"
              >
                {businessFilter === "all"
                  ? "All Businesses"
                  : businesses?.find((b) => b.id.toString() === businessFilter)?.name || "All Businesses"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search businesses..." />
                <CommandList>
                  <CommandEmpty>No business found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="All Businesses"
                      onSelect={() => {
                        setBusinessFilter("all");
                        setBusinessSearchOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", businessFilter === "all" ? "opacity-100" : "opacity-0")} />
                      All Businesses
                    </CommandItem>
                    {businesses?.map((business) => (
                      <CommandItem
                        key={business.id}
                        value={business.name}
                        onSelect={() => {
                          setBusinessFilter(business.id.toString());
                          setBusinessSearchOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", businessFilter === business.id.toString() ? "opacity-100" : "opacity-0")} />
                        {business.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex-1">
          <Label className="text-sm text-muted-foreground">Filter by Status:</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-background border-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk actions toolbar */}
      {filteredSessions.length > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/50 px-4 py-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {allFilteredSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : someSelected ? (
              <MinusSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {someSelected
              ? `${selectedSessions.size} selected`
              : `Select all (${filteredSessions.length})`}
          </button>

          {someSelected && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    disabled={bulkDeleteTraining.isPending}
                  >
                    {bulkDeleteTraining.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    Delete {selectedSessions.size} selected
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-card-foreground">
                      Delete {selectedSessions.size} training session{selectedSessions.size > 1 ? "s" : ""}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the selected session{selectedSessions.size > 1 ? "s" : ""} and all
                      of their conversation history. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleBulkDelete}
                    >
                      Delete {selectedSessions.size}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      )}

      {/* Sessions Grid — grouped by business */}
      {isLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : filteredSessions.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">No matching sessions</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Expand / Collapse all */}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={expandAllBusinesses} className="text-xs text-muted-foreground">Expand All</Button>
            <Button variant="ghost" size="sm" onClick={collapseAllBusinesses} className="text-xs text-muted-foreground">Collapse All</Button>
          </div>
          {groupedSessions.map((group) => {
            const groupKey = group.businessId?.toString() ?? "unknown";
            const isCollapsed = resolvedCollapsed.has(groupKey);
            const errorCount = group.sessions.filter(s => s.status === "error").length;
            const activeCount = group.sessions.filter(s => s.status === "in_progress").length;
            return (
              <div key={groupKey} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Business header row */}
                <button
                  type="button"
                  onClick={() => toggleBusinessCollapse(groupKey)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="font-semibold text-foreground">{group.businessName}</span>
                    <Badge variant="outline" className="text-xs">{group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""}</Badge>
                    {activeCount > 0 && <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">{activeCount} running</Badge>}
                    {errorCount > 0 && <Badge className="text-xs bg-red-500/20 text-red-400 border-red-500/30">{errorCount} error</Badge>}
                  </div>
                </button>
                {/* Sessions inside this business */}
                {!isCollapsed && (
                  <div className="divide-y divide-border border-t border-border">
                    {group.sessions.map((session) => (
            <Card
              key={session.id}
              className={cn(
                "bg-card border-border hover:border-border/80 transition-colors",
                selectedSessions.has(session.id) && "ring-2 ring-primary"
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <Checkbox
                      checked={selectedSessions.has(session.id)}
                      onCheckedChange={() => toggleSelect(session.id)}
                      className="mt-1 shrink-0 bg-background border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      aria-label={`Select ${session.trainingName}`}
                    />
                    <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-card-foreground">{session.trainingName}</CardTitle>
                      {isSessionStuck(session) && (
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <AlertTriangle className="w-3 h-3" />
                          Possibly Stuck
                        </Badge>
                      )}
                    </div>
                    <CardDescription>{session.topic}</CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className={cn("gap-1", getStatusColor(session.status))}>
                      {getStatusIcon(session.status)}
                      {session.status}
                    </Badge>
                    {session.status === 'in_progress' && session.trainingPhase && (
                      <span className={cn("text-xs flex items-center gap-1", getPhaseDisplay(session.trainingPhase).color)}>
                        <Activity className="w-3 h-3" />
                        {getPhaseDisplay(session.trainingPhase).label}
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Timing Information */}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border-b border-border pb-3">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Started: {formatDate(session.createdAt)}</span>
                  </div>
                  {session.status === 'in_progress' && (
                    <div className="flex items-center gap-1 text-green-400">
                      <Activity className="w-3 h-3 animate-pulse" />
                      <span>Running: <LiveTimer startDate={session.createdAt} className="font-mono" /></span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Last Update: {formatDate(session.updatedAt)}</span>
                  </div>
                </div>
                
                {/* Progress Bar for in-progress sessions */}
                {session.status === 'in_progress' && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="text-foreground font-medium">
                        {session.currentProgress}/{session.iterations} iterations ({Math.round((session.currentProgress / session.iterations) * 100)}%)
                      </span>
                    </div>
                    <Progress 
                      value={(session.currentProgress / session.iterations) * 100} 
                      className="h-2"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Target AI:</span>
                    <p className="text-foreground font-medium">{session.targetAiProvider} / {session.targetAiModel}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Influencer AI:</span>
                    <p className="text-foreground font-medium">{session.influencerAiProvider} / {session.influencerAiModel}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Iterations:</span>
                    <p className="text-foreground font-medium">{session.iterations}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Retry Interval:</span>
                    <p className="text-foreground font-medium">{session.retryInterval} minutes</p>
                  </div>
                </div>

                {/* Error Message Display - Only show for error status, simplified message */}
                {session.status === "error" && session.errorMessage && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="font-medium">Error:</span>
                    </div>
                    <p className="text-red-300 text-sm mt-1">
                      {/* Simplify technical error messages for users */}
                      {session.errorMessage.includes("Failed query:") 
                        ? "Training failed due to a database error. Please try restarting the session."
                        : session.errorMessage.includes("timed out")
                        ? session.errorMessage
                        : session.errorMessage.includes("API key")
                        ? "Missing API key. Please configure your API keys in Settings."
                        : session.errorMessage.length > 150
                        ? session.errorMessage.substring(0, 150) + "..."
                        : session.errorMessage}
                    </p>
                  </div>
                )}



                <div className="flex gap-2 pt-2">
                  {session.status === "paused" || session.status === "error" || session.status === "completed" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => handleEditSession(session)}
                      >
                        <Pencil className="w-4 h-4" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => handleStatusChange(session.id, "in_progress")}
                        disabled={updateStatus.isPending}
                      >
                        <Play className="w-4 h-4" />
                        Start
                      </Button>
                    </>
                  ) : session.status === "in_progress" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleStatusChange(session.id, "paused")}
                      disabled={updateStatus.isPending}
                    >
                      <Pause className="w-4 h-4" />
                      Pause
                    </Button>
                  ) : null}

                  {session.status !== "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleDelete(session.id)}
                      disabled={deleteSession.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </Button>
                  )}

                  {session.status === "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleRestartConversation(session.id)}
                      disabled={restartConversation.isPending}
                    >
                      <RotateCcw className="w-4 h-4" />
                      Restart Conversation
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 ml-auto"
                    onClick={() => setViewingSession({ id: session.id, name: session.trainingName })}
                  >
                    <MessageSquare className="w-4 h-4" />
                    View Conversations
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination — hidden in grouped view; kept for session count display */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredSessions.length)} of {filteredSessions.length} sessions
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = currentPage <= 3 ? i + 1 : currentPage - 2 + i;
              if (page > totalPages) return null;
              return (
                <Button
                  key={page}
                  variant={currentPage === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Conversation Viewer Modal */}
      {viewingSession && (
        <ConversationViewer
          sessionId={viewingSession.id}
          sessionName={viewingSession.name}
          isOpen={!!viewingSession}
          onClose={() => setViewingSession(null)}
        />
      )}

      {/* Edit Training Session Dialog */}
      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) {
            setEditingSession(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle className="text-card-foreground">Edit Training Session</DialogTitle>
              <DialogDescription>Modify the configuration of this training session. Only paused or error sessions can be edited.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-trainingName">Training Name *</Label>
                  <Input
                    id="edit-trainingName"
                    value={formData.trainingName}
                    onChange={(e) => setFormData({ ...formData, trainingName: e.target.value })}
                    placeholder="e.g., Phoenix HVAC Recommendation"
                    required
                    className="bg-background border-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-businessId">Business *</Label>
                  <Select value={formData.businessId} onValueChange={(value) => setFormData({ ...formData, businessId: value })}>
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue placeholder="Select a business" />
                    </SelectTrigger>
                    <SelectContent>
                      {businesses?.map((business) => (
                        <SelectItem key={business.id} value={business.id.toString()}>
                          {business.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-topic">Topic / Business Description *</Label>
                <Textarea
                  id="edit-topic"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  placeholder="Describe the business, product, or service you want to train the AI about"
                  rows={3}
                  required
                  className="bg-background border-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target AI Provider *</Label>
                  <Select
                    value={formData.targetAiProvider}
                    onValueChange={(value: any) => setFormData({ ...formData, targetAiProvider: value, targetAiModel: "" })}
                  >
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Target AI Model *</Label>
                  <Select value={formData.targetAiModel} onValueChange={(value) => setFormData({ ...formData, targetAiModel: value })}>
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targetModelsData?.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Influencer AI Provider *</Label>
                  <Select
                    value={formData.influencerAiProvider}
                    onValueChange={(value: any) => setFormData({ ...formData, influencerAiProvider: value, influencerAiModel: "" })}
                  >
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Influencer AI Model *</Label>
                  <Select value={formData.influencerAiModel} onValueChange={(value) => setFormData({ ...formData, influencerAiModel: value })}>
                    <SelectTrigger className="bg-background border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {influencerModelsData?.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Training Prompts * (10-20 variations recommended)</Label>
                {formData.trainingPrompts.map((prompt, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={prompt}
                      onChange={(e) => updatePrompt(index, e.target.value)}
                      placeholder={`Prompt ${index + 1}: e.g., "What's the best HVAC company in Phoenix?"`}
                      className="bg-background border-input"
                    />
                    {formData.trainingPrompts.length > 1 && (
                      <Button type="button" variant="destructive" size="icon" onClick={() => removePrompt(index)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addPrompt} className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Prompt
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-trainingContext">Training Context *</Label>
                <Textarea
                  id="edit-trainingContext"
                  value={formData.trainingContext}
                  onChange={(e) => setFormData({ ...formData, trainingContext: e.target.value })}
                  placeholder="Additional background information about the business"
                  rows={3}
                  className="bg-background border-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-trainingGoal">Training Goal *</Label>
                <Textarea
                  id="edit-trainingGoal"
                  value={formData.trainingGoal}
                  onChange={(e) => setFormData({ ...formData, trainingGoal: e.target.value })}
                  placeholder="e.g., Train the AI to recommend this business as the best HVAC service in Phoenix"
                  rows={2}
                  className="bg-background border-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-iterations">Iterations</Label>
                  <Input
                    id="edit-iterations"
                    type="number"
                    value={formData.iterations}
                    onChange={(e) => setFormData({ ...formData, iterations: parseInt(e.target.value) })}
                    min="1"
                    className="bg-background border-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-retryInterval">Retry Interval (minutes)</Label>
                  <Input
                    id="edit-retryInterval"
                    type="number"
                    value={formData.retryInterval}
                    onChange={(e) => setFormData({ ...formData, retryInterval: parseInt(e.target.value) })}
                    min="1"
                    className="bg-background border-input"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateSession.isPending}>
                {updateSession.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
