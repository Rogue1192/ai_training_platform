import { useState, useEffect, useMemo } from "react";
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
import { Loader2, Plus, Play, Pause, RotateCcw, Trash2, MessageSquare, Brain, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationViewer } from "@/components/ConversationViewer";

export default function TrainingSessions() {
  const { data: sessions, isLoading, refetch } = trpc.training.list.useQuery();
  const { data: businesses } = trpc.business.list.useQuery();
  const createSession = trpc.training.create.useMutation();
  const updateStatus = trpc.training.updateStatus.useMutation();
  const deleteSession = trpc.training.delete.useMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewingSession, setViewingSession] = useState<{ id: number; name: string } | null>(null);
  const [businessFilter, setBusinessFilter] = useState<string>("all");
  const [businessSearchOpen, setBusinessSearchOpen] = useState(false);
  const [businessSearchQuery, setBusinessSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
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

    if (!formData.trainingName.trim() || !formData.topic.trim() || !formData.trainingGoal.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (formData.trainingPrompts.filter((p) => p.trim()).length === 0) {
      toast.error("Please add at least one training prompt");
      return;
    }

    try {
      await createSession.mutateAsync({
        businessId: formData.businessId ? parseInt(formData.businessId) : undefined,
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

  const addPrompt = () => {
    setFormData({ ...formData, trainingPrompts: [...formData.trainingPrompts, ""] });
  };

  const updatePrompt = (index: number, value: string) => {
    const newPrompts = [...formData.trainingPrompts];
    newPrompts[index] = value;
    setFormData({ ...formData, trainingPrompts: newPrompts });
  };

  const removePrompt = (index: number) => {
    const newPrompts = formData.trainingPrompts.filter((_, i) => i !== index);
    setFormData({ ...formData, trainingPrompts: newPrompts });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string }> = {
      paused: { variant: "secondary", label: "Paused" },
      in_progress: { variant: "default", label: "In Progress" },
      completed: { variant: "default", label: "Completed" },
      error: { variant: "destructive", label: "Error" },
    };

    const config = variants[status] || variants.paused;
    return <Badge variant={config.variant}>{config.label}</Badge>;
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
          <h1 className="text-3xl font-bold text-foreground">Training Sessions</h1>
          <p className="text-muted-foreground mt-2">Create and manage AI training sessions</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Filter by Business:</Label>
            <Popover open={businessSearchOpen} onOpenChange={setBusinessSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={businessSearchOpen}
                  className="w-[200px] justify-between bg-background border-input"
                >
                  {businessFilter === "all"
                    ? "All Businesses"
                    : businessFilter === "unassigned"
                    ? "Unassigned"
                    : businesses?.find((b) => b.id.toString() === businessFilter)?.name || "Select business..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0">
                <Command>
                  <CommandInput placeholder="Search businesses..." />
                  <CommandList>
                    <CommandEmpty>No business found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="all"
                        onSelect={() => {
                          setBusinessFilter("all");
                          setBusinessSearchOpen(false);
                          setCurrentPage(1);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", businessFilter === "all" ? "opacity-100" : "opacity-0")} />
                        All Businesses
                      </CommandItem>
                      <CommandItem
                        value="unassigned"
                        onSelect={() => {
                          setBusinessFilter("unassigned");
                          setBusinessSearchOpen(false);
                          setCurrentPage(1);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", businessFilter === "unassigned" ? "opacity-100" : "opacity-0")} />
                        Unassigned
                      </CommandItem>
                      {businesses?.map((business) => (
                        <CommandItem
                          key={business.id}
                          value={business.name}
                          onSelect={() => {
                            setBusinessFilter(business.id.toString());
                            setBusinessSearchOpen(false);
                            setCurrentPage(1);
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
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Status:</Label>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[140px] bg-background border-input">
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
              New Training
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle className="text-card-foreground">Create Training Session</DialogTitle>
                <DialogDescription>Configure a new AI training session with your goals and parameters</DialogDescription>
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
                        <SelectItem value="google">Google AI</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Target AI Model *</Label>
                    <Select value={formData.targetAiModel} onValueChange={(value) => setFormData({ ...formData, targetAiModel: value })}>
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue placeholder="Select model" />
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
                        <SelectItem value="google">Google AI</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Influencer AI Model *</Label>
                    <Select
                      value={formData.influencerAiModel}
                      onValueChange={(value) => setFormData({ ...formData, influencerAiModel: value })}
                    >
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue placeholder="Select model" />
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
                  <Label htmlFor="trainingContext">Training Context (Optional)</Label>
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
                    required
                    className="bg-background border-input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="iterations">Iterations</Label>
                    <Input
                      id="iterations"
                      type="number"
                      min="1"
                      value={formData.iterations}
                      onChange={(e) => setFormData({ ...formData, iterations: parseInt(e.target.value) })}
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="retryInterval">Retry Interval (minutes)</Label>
                    <Select
                      value={formData.retryInterval.toString()}
                      onValueChange={(value) => setFormData({ ...formData, retryInterval: parseInt(value) })}
                    >
                      <SelectTrigger className="bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="10">10 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">1 hour</SelectItem>
                      </SelectContent>
                    </Select>
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

      {/* Pagination calculations */}
      {(() => {
        const filteredSessions = sessions?.filter((session) => {
          // Business filter
          const matchesBusiness = 
            businessFilter === "all" ? true :
            businessFilter === "unassigned" ? !session.businessId :
            session.businessId?.toString() === businessFilter;
          
          // Status filter
          const matchesStatus = 
            statusFilter === "all" ? true :
            session.status === statusFilter;
          
          return matchesBusiness && matchesStatus;
        }) || [];
        
        const totalItems = filteredSessions.length;
        const totalPages = Math.ceil(totalItems / pageSize);
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedSessions = filteredSessions.slice(startIndex, endIndex);
        
        // Generate page numbers to display
        const getPageNumbers = () => {
          const pages: (number | string)[] = [];
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
          } else {
            pages.push(1);
            if (currentPage > 3) pages.push("...");
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
              pages.push(i);
            }
            if (currentPage < totalPages - 2) pages.push("...");
            pages.push(totalPages);
          }
          return pages;
        };

        return (
          <>
            {sessions && sessions.length === 0 ? (
              <Card className="bg-card border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Brain className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No training sessions yet</h3>
                  <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                    Create your first training session to start influencing AI recommendations for your clients.
                  </p>
                  <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Training Session
                  </Button>
                </CardContent>
              </Card>
            ) : filteredSessions.length === 0 ? (
              <Card className="bg-card border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Brain className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No matching sessions</h3>
                  <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                    No training sessions match the selected filter. Try selecting a different business or status.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Page size selector and info */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Show</span>
                    <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(parseInt(v)); setCurrentPage(1); }}>
                      <SelectTrigger className="w-[70px] h-8 bg-background border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">per page</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems} sessions
                  </span>
                </div>

                <div className="grid gap-4">
                  {paginatedSessions.map((session) => (
            <Card key={session.id} className="bg-card border-border">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <CardTitle className="text-card-foreground">{session.trainingName}</CardTitle>
                      {getStatusBadge(session.status)}
                    </div>
                    <CardDescription className="line-clamp-2">{session.topic}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {session.status === "paused" && (
                      <Button size="sm" onClick={() => handleStatusChange(session.id, "in_progress")}>
                        <Play className="w-4 h-4 mr-2" />
                        Start
                      </Button>
                    )}
                    {session.status === "in_progress" && (
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange(session.id, "paused")}>
                        <Pause className="w-4 h-4 mr-2" />
                        Pause
                      </Button>
                    )}
                    {session.status === "completed" && (
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange(session.id, "paused")}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Restart
                      </Button>
                    )}
                    {session.status === "error" && (
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange(session.id, "paused")}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setViewingSession({ id: session.id, name: session.trainingName })}>
                      <MessageSquare className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(session.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Target AI:</span>
                    <p className="font-medium text-foreground">
                      {session.targetAiProvider} / {session.targetAiModel}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Influencer AI:</span>
                    <p className="font-medium text-foreground">
                      {session.influencerAiProvider} / {session.influencerAiModel}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Iterations:</span>
                    <p className="font-medium text-foreground">{session.iterations}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Retry Interval:</span>
                    <p className="font-medium text-foreground">{session.retryInterval} min</p>
                  </div>
                </div>
                {session.status === "error" && session.errorMessage && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                    <p className="text-sm text-destructive font-medium">Error: {session.errorMessage}</p>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium text-foreground">
                      {session.currentProgress} / {session.iterations}
                    </span>
                  </div>
                  <Progress value={(session.currentProgress / session.iterations) * 100} className="h-2" />
                </div>
              </CardContent>
            </Card>
          ))}
                </div>

                {/* Pagination controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    
                    {getPageNumbers().map((page, index) => (
                      typeof page === "number" ? (
                        <Button
                          key={index}
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          className="h-8 w-8 p-0"
                        >
                          {page}
                        </Button>
                      ) : (
                        <span key={index} className="px-2 text-muted-foreground">...</span>
                      )
                    ))}
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}

      {/* Conversation Viewer Modal */}
      {viewingSession && (
        <ConversationViewer
          sessionId={viewingSession.id}
          sessionName={viewingSession.name}
          isOpen={!!viewingSession}
          onClose={() => setViewingSession(null)}
        />
      )}
    </div>
  );
}
