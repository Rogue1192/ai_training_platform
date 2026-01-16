import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { Loader2, Plus, Play, Pause, RotateCcw, Trash2, MessageSquare, Brain, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check, ChevronsUpDown, Square, CheckSquare, MinusSquare, Pencil } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ConversationViewer } from "@/components/ConversationViewer";

export default function TrainingSessions() {
  const { data: sessions, isLoading, refetch } = trpc.training.list.useQuery();
  const { data: businesses } = trpc.business.list.useQuery();
  const createSession = trpc.training.create.useMutation();
  const updateSession = trpc.training.update.useMutation();
  const updateStatus = trpc.training.updateStatus.useMutation();
  const deleteSession = trpc.training.delete.useMutation();

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
  const [showBulkActions, setShowBulkActions] = useState(false);
  
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
      // Show a more descriptive error for API key issues
      const errorMessage = error.message || "Failed to update status";
      if (errorMessage.includes("Missing API key")) {
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
    if (businessFilter !== "all" && session.businessId && session.businessId.toString() !== businessFilter) {
      return false;
    }
    if (statusFilter !== "all" && session.status !== statusFilter) {
      return false;
    }
    return true;
  }) || [];

  // Paginate sessions
  const paginatedSessions = filteredSessions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalPages = Math.ceil(filteredSessions.length / pageSize);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Training Sessions</h1>
          <p className="text-muted-foreground">Create and manage AI training sessions</p>
        </div>
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

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Label className="text-sm text-muted-foreground">Filter by Business:</Label>
          <Select value={businessFilter} onValueChange={setBusinessFilter}>
            <SelectTrigger className="bg-background border-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Businesses</SelectItem>
              {businesses?.map((business) => (
                <SelectItem key={business.id} value={business.id.toString()}>
                  {business.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      {/* Sessions Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : paginatedSessions.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">No matching sessions</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {paginatedSessions.map((session) => (
            <Card key={session.id} className="bg-card border-border hover:border-border/80 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-card-foreground">{session.trainingName}</CardTitle>
                    <CardDescription>{session.topic}</CardDescription>
                  </div>
                  <Badge className={cn("gap-1", getStatusColor(session.status))}>
                    {getStatusIcon(session.status)}
                    {session.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
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



                <div className="flex gap-2 pt-2">
                  {session.status === "paused" || session.status === "error" ? (
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

      {/* Pagination */}
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
