import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  FileText,
  Plus,
  Edit3,
  Trash2,
  RotateCcw,
  Loader2,
  Sparkles,
  MessageSquare,
  ArrowRight,
  Layers,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const typeLabels: Record<string, { label: string; icon: any; color: string; description: string }> = {
  clean: {
    label: "Clean",
    icon: Sparkles,
    color: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    description: "Natural, conversational prompts that don't mention the business directly",
  },
  suggestive: {
    label: "Suggestive",
    icon: ArrowRight,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    description: "Prompts that guide the AI toward mentioning the business",
  },
  follow_up: {
    label: "Follow-Up",
    icon: MessageSquare,
    color: "text-green-400 bg-green-500/10 border-green-500/30",
    description: "Prompts that build on previous conversation context",
  },
  category_based: {
    label: "Category",
    icon: Layers,
    color: "text-orange-400 bg-orange-500/10 border-orange-500/30",
    description: "Prompts organized by industry or service category",
  },
};

export default function PromptTemplates() {
  const [activeTab, setActiveTab] = useState("clean");
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    templateType: "clean" as string,
    templateName: "",
    templateContent: "",
    isActive: true,
    sortOrder: 0,
  });

  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.promptTemplate.list.useQuery();

  const createMutation = trpc.promptTemplate.create.useMutation({
    onSuccess: () => {
      toast.success("Template created");
      setShowCreateDialog(false);
      setNewTemplate({ templateType: "clean", templateName: "", templateContent: "", isActive: true, sortOrder: 0 });
      utils.promptTemplate.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.promptTemplate.update.useMutation({
    onSuccess: () => {
      toast.success("Template updated");
      setEditingTemplate(null);
      utils.promptTemplate.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.promptTemplate.delete.useMutation({
    onSuccess: () => {
      toast.success("Template deleted");
      utils.promptTemplate.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resetMutation = trpc.promptTemplate.resetToDefaults.useMutation({
    onSuccess: () => {
      toast.success("Templates reset to defaults");
      utils.promptTemplate.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredTemplates = templates?.filter((t: any) => t.templateType === activeTab) || [];

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
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Prompt Templates
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage the training prompts used to train AI models on your clients
          </p>
        </div>
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset Defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all templates?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all custom templates and restore the default set. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => resetMutation.mutate()}>
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Prompt Template</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Type</label>
                    <Select value={newTemplate.templateType} onValueChange={(v) => setNewTemplate({ ...newTemplate, templateType: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="clean">Clean</SelectItem>
                        <SelectItem value="suggestive">Suggestive</SelectItem>
                        <SelectItem value="follow_up">Follow-Up</SelectItem>
                        <SelectItem value="category_based">Category</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Name</label>
                    <Input
                      value={newTemplate.templateName}
                      onChange={(e) => setNewTemplate({ ...newTemplate, templateName: e.target.value })}
                      placeholder="Template name..."
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Prompt Content</label>
                  <Textarea
                    value={newTemplate.templateContent}
                    onChange={(e) => setNewTemplate({ ...newTemplate, templateContent: e.target.value })}
                    placeholder="Enter the prompt template content. Use {{business_name}}, {{industry}}, {{location}} as variables..."
                    rows={8}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Variables: {"{{business_name}}"}, {"{{industry}}"}, {"{{location}}"}, {"{{website}}"}, {"{{service_area}}"}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
                <Button
                  onClick={() => createMutation.mutate(newTemplate as any)}
                  disabled={!newTemplate.templateName || !newTemplate.templateContent || createMutation.isPending}
                >
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Create Template
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Type tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50">
          {Object.entries(typeLabels).map(([key, config]) => {
            const Icon = config.icon;
            const count = templates?.filter((t: any) => t.templateType === key).length || 0;
            return (
              <TabsTrigger key={key} value={key} className="gap-2">
                <Icon className="w-4 h-4" />
                {config.label}
                <Badge variant="secondary" className="text-xs ml-1">{count}</Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {Object.entries(typeLabels).map(([key, config]) => (
          <TabsContent key={key} value={key} className="space-y-4">
            <Card className="bg-card/50 border-border">
              <CardContent className="p-3">
                <p className="text-sm text-muted-foreground">{config.description}</p>
              </CardContent>
            </Card>

            {filteredTemplates.length > 0 ? (
              <div className="space-y-3">
                {filteredTemplates.map((template: any) => (
                  <Card key={template.id} className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-foreground">{template.templateName}</h3>
                            <Badge variant={template.isActive ? "default" : "secondary"} className="text-xs">
                              {template.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono bg-muted/30 rounded-md p-3 max-h-32 overflow-y-auto">
                            {template.templateContent}
                          </pre>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              navigator.clipboard.writeText(template.templateContent);
                              toast.success("Copied!");
                            }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditingTemplate(template)}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Delete this template?")) {
                                deleteMutation.mutate({ id: template.id });
                              }
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-card border-border">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="w-10 h-10 text-muted-foreground mb-3" />
                  <h3 className="text-lg font-semibold text-foreground mb-1">No {config.label} templates</h3>
                  <p className="text-sm text-muted-foreground">
                    Create a new template or reset to defaults.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Name</label>
                  <Input
                    value={editingTemplate.templateName}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, templateName: e.target.value })}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editingTemplate.isActive}
                      onCheckedChange={(checked) => setEditingTemplate({ ...editingTemplate, isActive: checked })}
                    />
                    <span className="text-sm text-foreground">{editingTemplate.isActive ? "Active" : "Inactive"}</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Prompt Content</label>
                <Textarea
                  value={editingTemplate.templateContent}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, templateContent: e.target.value })}
                  rows={10}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
            <Button
              onClick={() => {
                updateMutation.mutate({
                  id: editingTemplate.id,
                  templateName: editingTemplate.templateName,
                  templateContent: editingTemplate.templateContent,
                  isActive: editingTemplate.isActive,
                });
              }}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
