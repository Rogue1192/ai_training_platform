import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, RotateCcw, MessageSquare, Info } from "lucide-react";

type TemplateType = "clean" | "suggestive" | "follow_up" | "category_based" | "content_generation" | "credibility_research";

interface PromptTemplate {
  id: number;
  templateType: string;
  templateName: string;
  templateContent: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const TEMPLATE_TYPE_INFO: Record<TemplateType, { title: string; description: string; variables: string[] }> = {
  clean: {
    title: "Clean Prompts",
    description: "Used for baseline and evaluation tests. These prompts should NOT mention the business name.",
    variables: ["{businessType}", "{location}"],
  },
  suggestive: {
    title: "Suggestive Prompts",
    description: "Used during training to expose the AI to positive associations with the business.",
    variables: ["{cleanPrompt}", "{businessName}", "{businessType}", "{location}"],
  },
  follow_up: {
    title: "Follow-up Prompts",
    description: "Used when the AI doesn't mention the business in the initial response.",
    variables: ["{businessName}", "{businessType}", "{location}"],
  },
  category_based: {
    title: "Category-Based Prompts",
    description: "Fallback prompts when the original prompt can't be cleaned. Based on business type and location.",
    variables: ["{businessType}", "{location}"],
  },
  content_generation: {
    title: "Content Generation Prompts",
    description: "Used by Claude Sonnet to generate AI-optimized credibility pages for the client's website. Each page type has its own template.",
    variables: ["{businessName}", "{businessType}", "{location}", "{pageType}", "{credibilityFacts}", "{publishedUrls}"],
  },
  credibility_research: {
    title: "Credibility Research Prompts",
    description: "Used by Claude Haiku to research, verify, and expand on the client's credentials. Outputs structured facts and source URLs that feed into content generation and training.",
    variables: ["{businessName}", "{businessType}", "{onboardingData}", "{certifications}", "{awards}", "{licenses}"],
  },
};

export default function PromptTemplateEditor() {
  const [activeTab, setActiveTab] = useState<TemplateType>("clean");
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: "", content: "" });

  const { data: templates, isLoading, refetch } = trpc.promptTemplate.list.useQuery();
  const createMutation = trpc.promptTemplate.create.useMutation();
  const updateMutation = trpc.promptTemplate.update.useMutation();
  const deleteMutation = trpc.promptTemplate.delete.useMutation();
  const resetMutation = trpc.promptTemplate.resetToDefaults.useMutation();

  const filteredTemplates = templates?.filter((t) => t.templateType === activeTab) || [];

  const handleCreate = async () => {
    if (!newTemplate.name.trim() || !newTemplate.content.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      await createMutation.mutateAsync({
        templateType: activeTab,
        templateName: newTemplate.name,
        templateContent: newTemplate.content,
        isActive: true,
        sortOrder: filteredTemplates.length,
      });
      toast.success("Template created successfully");
      setNewTemplate({ name: "", content: "" });
      setIsCreateDialogOpen(false);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to create template");
    }
  };

  const handleUpdate = async (template: PromptTemplate, updates: Partial<PromptTemplate>) => {
    try {
      const payload: any = {
        id: template.id,
        ...updates,
      };
      await updateMutation.mutateAsync(payload);
      toast.success("Template updated successfully");
      setEditingTemplate(null);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to update template");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Template deleted successfully");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete template");
    }
  };

  const handleResetToDefaults = async () => {
    try {
      await resetMutation.mutateAsync();
      toast.success("Templates reset to defaults");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to reset templates");
    }
  };

  const handleToggleActive = async (template: PromptTemplate) => {
    await handleUpdate(template, { isActive: !template.isActive });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle>Prompt Templates</CardTitle>
              <CardDescription>Customize the prompts used during AI training sessions</CardDescription>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset to Defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset to Default Templates?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all your custom templates and restore the default ones. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetToDefaults} disabled={resetMutation.isPending}>
                  {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reset"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TemplateType)}>
          <TabsList className="grid w-full grid-cols-6 mb-6">
            <TabsTrigger value="clean">Clean</TabsTrigger>
            <TabsTrigger value="suggestive">Suggestive</TabsTrigger>
            <TabsTrigger value="follow_up">Follow-up</TabsTrigger>
            <TabsTrigger value="category_based">Category</TabsTrigger>
            <TabsTrigger value="content_generation">Content</TabsTrigger>
            <TabsTrigger value="credibility_research">Research</TabsTrigger>
          </TabsList>

          {(["clean", "suggestive", "follow_up", "category_based", "content_generation", "credibility_research"] as TemplateType[]).map((type) => (
            <TabsContent key={type} value={type} className="space-y-4">
              {/* Info Box */}
              <div className="bg-muted/50 border border-border rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-primary mt-0.5" />
                  <div>
                    <h4 className="font-medium text-foreground">{TEMPLATE_TYPE_INFO[type].title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">{TEMPLATE_TYPE_INFO[type].description}</p>
                    <div className="mt-2">
                      <span className="text-xs text-muted-foreground">Available variables: </span>
                      {TEMPLATE_TYPE_INFO[type].variables.map((v, i) => (
                        <code key={v} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded mx-0.5">
                          {v}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Template List */}
              <div className="space-y-3">
                {filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    className={`border rounded-lg p-4 transition-colors ${
                      template.isActive ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-60"
                    }`}
                  >
                    {editingTemplate?.id === template.id ? (
                      <div className="space-y-3">
                        <Input
                          value={editingTemplate.templateName}
                          onChange={(e) =>
                            setEditingTemplate({ ...editingTemplate, templateName: e.target.value })
                          }
                          placeholder="Template name"
                          className="bg-background"
                        />
                        <Textarea
                          value={editingTemplate.templateContent}
                          onChange={(e) =>
                            setEditingTemplate({ ...editingTemplate, templateContent: e.target.value })
                          }
                          placeholder="Template content"
                          rows={3}
                          className="bg-background font-mono text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              handleUpdate(template, {
                                templateName: editingTemplate.templateName,
                                templateContent: editingTemplate.templateContent,
                              })
                            }
                            disabled={updateMutation.isPending}
                          >
                            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingTemplate(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-foreground">{template.templateName}</h4>
                            {!template.isActive && (
                              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                                Disabled
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 font-mono break-all">
                            {template.templateContent}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={template.isActive}
                            onCheckedChange={() => handleToggleActive(template)}
                            disabled={updateMutation.isPending}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditingTemplate(template)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Template?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{template.templateName}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(template.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {filteredTemplates.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No templates found. Click "Add Template" to create one.
                  </div>
                )}
              </div>

              {/* Add Template Button */}
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Template
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Template</DialogTitle>
                    <DialogDescription>
                      Add a new {TEMPLATE_TYPE_INFO[activeTab].title.toLowerCase()} template.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="template-name">Template Name</Label>
                      <Input
                        id="template-name"
                        value={newTemplate.name}
                        onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                        placeholder="e.g., Best services question"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="template-content">Template Content</Label>
                      <Textarea
                        id="template-content"
                        value={newTemplate.content}
                        onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                        placeholder={`e.g., What are the best {businessType} services in {location}?`}
                        rows={4}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        Available variables:{" "}
                        {TEMPLATE_TYPE_INFO[activeTab].variables.map((v) => (
                          <code key={v} className="bg-muted px-1 rounded mx-0.5">
                            {v}
                          </code>
                        ))}
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={createMutation.isPending}>
                      {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
