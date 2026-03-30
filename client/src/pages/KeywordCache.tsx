import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Database,
  Lock,
  Unlock,
  RefreshCw,
  Trash2,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Crown,
  Sparkles,
  Users,
  Clock,
  TrendingUp,
  X,
  Plus,
  Save,
  AlertTriangle,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

interface CachedKeyword {
  keyword: string;
  aiSearchVolume?: number;
  searchVolume?: number;
  searchIntent?: string;
  category?: string;
  frequency?: number;
}

export default function KeywordCache() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [sortField, setSortField] = useState<"keyword" | "aiSearchVolume" | "frequency">("aiSearchVolume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editMode, setEditMode] = useState(false);
  const [editedKeywords, setEditedKeywords] = useState<CachedKeyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [showGoldenOnly, setShowGoldenOnly] = useState(false);

  const utils = trpc.useUtils();
  const { data: caches, isLoading } = trpc.industryCache.list.useQuery();

  const lockMutation = trpc.industryCache.lock.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      utils.industryCache.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const unlockMutation = trpc.industryCache.unlock.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      utils.industryCache.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateKeywordsMutation = trpc.industryCache.updateKeywords.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setEditMode(false);
      utils.industryCache.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateThresholdMutation = trpc.industryCache.updateLockThreshold.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      utils.industryCache.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.industryCache.delete.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setSelectedIndustry(null);
      utils.industryCache.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const refreshMutation = trpc.industryCache.refresh.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      utils.industryCache.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredCaches = useMemo(() => {
    if (!caches) return [];
    if (!searchQuery) return caches;
    return caches.filter((c: any) =>
      c.industry.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [caches, searchQuery]);

  const selectedCache = useMemo(() => {
    if (!selectedIndustry || !caches) return null;
    return caches.find((c: any) => c.industry === selectedIndustry) || null;
  }, [selectedIndustry, caches]);

  const displayKeywords = useMemo(() => {
    if (!selectedCache) return [];
    
    const source = editMode
      ? editedKeywords
      : showGoldenOnly && selectedCache.goldenTemplateKeywords
        ? (selectedCache.goldenTemplateKeywords as CachedKeyword[])
        : (selectedCache.keywords as CachedKeyword[]);

    const sorted = [...source].sort((a, b) => {
      if (sortField === "keyword") {
        return sortDir === "asc"
          ? a.keyword.localeCompare(b.keyword)
          : b.keyword.localeCompare(a.keyword);
      }
      const aVal = (a as any)[sortField] || 0;
      const bVal = (b as any)[sortField] || 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [selectedCache, editMode, editedKeywords, showGoldenOnly, sortField, sortDir]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3.5 h-3.5 inline ml-1" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 inline ml-1" />
    );
  };

  const startEdit = () => {
    if (!selectedCache) return;
    const source = showGoldenOnly && selectedCache.goldenTemplateKeywords
      ? (selectedCache.goldenTemplateKeywords as CachedKeyword[])
      : (selectedCache.keywords as CachedKeyword[]);
    setEditedKeywords([...source]);
    setEditMode(true);
  };

  const removeKeyword = (index: number) => {
    setEditedKeywords((prev) => prev.filter((_, i) => i !== index));
  };

  const addKeyword = () => {
    if (!newKeyword.trim()) return;
    setEditedKeywords((prev) => [
      ...prev,
      { keyword: newKeyword.trim(), aiSearchVolume: 0, searchVolume: 0, frequency: 1 },
    ]);
    setNewKeyword("");
  };

  const saveKeywords = () => {
    if (!selectedIndustry) return;
    updateKeywordsMutation.mutate({
      industry: selectedIndustry,
      keywords: editedKeywords,
      updateGolden: showGoldenOnly,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ─── Detail View ──────────────────────────────────────────────────────────
  if (selectedIndustry && selectedCache) {
    const keywords = selectedCache.keywords as CachedKeyword[];
    const goldenKeywords = selectedCache.goldenTemplateKeywords as CachedKeyword[] | null;
    const totalVolume = keywords.reduce((sum, k) => sum + (k.aiSearchVolume || 0), 0);
    const avgFrequency = keywords.length > 0
      ? (keywords.reduce((sum, k) => sum + (k.frequency || 0), 0) / keywords.length).toFixed(1)
      : "0";

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedIndustry(null); setEditMode(false); setShowGoldenOnly(false); }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-foreground capitalize" style={{ fontFamily: "var(--font-heading)" }}>
                {selectedCache.industry}
              </h1>
              {selectedCache.isLocked ? (
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                  <Lock className="w-3 h-3 mr-1" /> Golden Template Locked
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <Unlock className="w-3 h-3 mr-1" /> Unlocked
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              {keywords.length} keywords cached from {selectedCache.clientCount} client{selectedCache.clientCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {editMode ? (
              <>
                <Button variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
                <Button onClick={saveKeywords} disabled={updateKeywordsMutation.isPending}>
                  {updateKeywordsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save {showGoldenOnly ? "Golden Template" : "Keywords"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={startEdit}>
                  Edit Keywords
                </Button>
                {selectedCache.isLocked ? (
                  <Button
                    variant="outline"
                    className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => unlockMutation.mutate({ industry: selectedIndustry })}
                    disabled={unlockMutation.isPending}
                  >
                    <Unlock className="w-4 h-4 mr-2" /> Unlock
                  </Button>
                ) : (
                  <Button
                    className="bg-amber-600 hover:bg-amber-700"
                    onClick={() => lockMutation.mutate({ industry: selectedIndustry })}
                    disabled={lockMutation.isPending}
                  >
                    <Lock className="w-4 h-4 mr-2" /> Lock Golden Template
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10">
                      <RefreshCw className="w-4 h-4 mr-2" /> Reset
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset cache for {selectedCache.industry}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will unlock the golden template, clear it, and reset the client count to 0. The next keyword research run for this industry will rebuild the cache from scratch.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => refreshMutation.mutate({ industry: selectedIndustry })}>
                        Reset Cache
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <Database className="w-5 h-5 mx-auto text-primary mb-1" />
              <p className="text-2xl font-bold text-foreground">{keywords.length}</p>
              <p className="text-xs text-muted-foreground">Total Keywords</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <Crown className="w-5 h-5 mx-auto text-amber-400 mb-1" />
              <p className="text-2xl font-bold text-foreground">{goldenKeywords?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Golden Keywords</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <TrendingUp className="w-5 h-5 mx-auto text-green-400 mb-1" />
              <p className="text-2xl font-bold text-foreground">{totalVolume.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total AI Volume</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <Users className="w-5 h-5 mx-auto text-blue-400 mb-1" />
              <p className="text-2xl font-bold text-foreground">{selectedCache.clientCount}/{selectedCache.lockThreshold}</p>
              <p className="text-xs text-muted-foreground">Clients / Lock Threshold</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <Sparkles className="w-5 h-5 mx-auto text-purple-400 mb-1" />
              <p className="text-2xl font-bold text-foreground">{avgFrequency}</p>
              <p className="text-xs text-muted-foreground">Avg Frequency</p>
            </CardContent>
          </Card>
        </div>

        {/* Lock Threshold Control */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Lock Threshold</p>
                <p className="text-xs text-muted-foreground">
                  Number of clients needed before the golden template auto-locks. Currently {selectedCache.clientCount} of {selectedCache.lockThreshold}.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {[2, 3, 5, 10].map((val) => (
                  <Button
                    key={val}
                    variant={selectedCache.lockThreshold === val ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateThresholdMutation.mutate({ industry: selectedIndustry, lockThreshold: val })}
                    disabled={updateThresholdMutation.isPending}
                  >
                    {val}
                  </Button>
                ))}
              </div>
            </div>
            {selectedCache.clientCount >= selectedCache.lockThreshold && !selectedCache.isLocked && (
              <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Threshold reached but not locked. Lock the golden template to freeze the top keywords for this industry.
              </div>
            )}
          </CardContent>
        </Card>

        {/* View Toggle */}
        {goldenKeywords && goldenKeywords.length > 0 && !editMode && (
          <div className="flex gap-2">
            <Button
              variant={!showGoldenOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowGoldenOnly(false)}
            >
              All Keywords ({keywords.length})
            </Button>
            <Button
              variant={showGoldenOnly ? "default" : "outline"}
              size="sm"
              className={showGoldenOnly ? "bg-amber-600 hover:bg-amber-700" : ""}
              onClick={() => setShowGoldenOnly(true)}
            >
              <Crown className="w-3.5 h-3.5 mr-1.5" />
              Golden Template ({goldenKeywords.length})
            </Button>
          </div>
        )}

        {/* Add Keyword (Edit Mode) */}
        {editMode && (
          <div className="flex gap-2">
            <Input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="Add a keyword..."
              onKeyDown={(e) => e.key === "Enter" && addKeyword()}
            />
            <Button onClick={addKeyword} disabled={!newKeyword.trim()}>
              <Plus className="w-4 h-4 mr-2" /> Add
            </Button>
          </div>
        )}

        {/* Keywords Table */}
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-8 text-muted-foreground">#</TableHead>
                    <TableHead
                      className="cursor-pointer text-muted-foreground hover:text-foreground"
                      onClick={() => handleSort("keyword")}
                    >
                      Keyword <SortIcon field="keyword" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right text-muted-foreground hover:text-foreground"
                      onClick={() => handleSort("aiSearchVolume")}
                    >
                      AI Search Vol <SortIcon field="aiSearchVolume" />
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">Search Vol</TableHead>
                    <TableHead className="text-muted-foreground">Intent</TableHead>
                    <TableHead
                      className="cursor-pointer text-right text-muted-foreground hover:text-foreground"
                      onClick={() => handleSort("frequency")}
                    >
                      Freq <SortIcon field="frequency" />
                    </TableHead>
                    {editMode && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayKeywords.map((kw, idx) => {
                    const isGolden = goldenKeywords?.some((g) => g.keyword === kw.keyword);
                    return (
                      <TableRow
                        key={`${kw.keyword}-${idx}`}
                        className={`border-border ${isGolden && !showGoldenOnly ? "bg-amber-500/5" : ""}`}
                      >
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            {kw.keyword}
                            {isGolden && !showGoldenOnly && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                                </TooltipTrigger>
                                <TooltipContent>Golden template keyword</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`font-mono text-sm ${
                            (kw.aiSearchVolume || 0) > 1000
                              ? "text-green-400"
                              : (kw.aiSearchVolume || 0) > 100
                                ? "text-blue-400"
                                : "text-muted-foreground"
                          }`}>
                            {(kw.aiSearchVolume || 0).toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {(kw.searchVolume || 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {kw.searchIntent ? (
                            <Badge variant="secondary" className="text-xs capitalize">
                              {kw.searchIntent}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {kw.frequency || "—"}
                        </TableCell>
                        {editMode && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeKeyword(idx)}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {displayKeywords.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={editMode ? 7 : 6} className="text-center py-8 text-muted-foreground">
                        No keywords found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Metadata */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Created: {new Date(selectedCache.createdAt).toLocaleDateString()}
            </span>
            {selectedCache.lastRefreshedAt && (
              <span className="flex items-center gap-1">
                <RefreshCw className="w-3.5 h-3.5" />
                Last refreshed: {new Date(selectedCache.lastRefreshedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Cache
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete cache for {selectedCache.industry}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all cached keywords for this industry. New campaigns in this industry will need to run fresh keyword research.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90"
                  onClick={() => deleteMutation.mutate({ industry: selectedIndustry })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  }

  // ─── List View ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Industry Keyword Cache
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage cached keyword research data by industry. Lock golden templates to skip API calls for repeat industries.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search industries..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Summary Stats */}
      {caches && caches.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{caches.length}</p>
              <p className="text-xs text-muted-foreground">Industries Cached</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">
                {caches.filter((c: any) => c.isLocked).length}
              </p>
              <p className="text-xs text-muted-foreground">Golden Templates</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">
                {caches.reduce((sum: number, c: any) => sum + ((c.keywords as any[])?.length || 0), 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Total Keywords</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">
                {caches.reduce((sum: number, c: any) => sum + (c.clientCount || 0), 0)}
              </p>
              <p className="text-xs text-muted-foreground">Total Clients</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Industry Cards */}
      {filteredCaches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCaches.map((cache: any) => {
            const keywords = cache.keywords as CachedKeyword[];
            const goldenKeywords = cache.goldenTemplateKeywords as CachedKeyword[] | null;
            const topKeywords = keywords
              .sort((a, b) => (b.aiSearchVolume || 0) - (a.aiSearchVolume || 0))
              .slice(0, 5);
            const totalVolume = keywords.reduce((sum, k) => sum + (k.aiSearchVolume || 0), 0);

            return (
              <Card
                key={cache.id}
                className="bg-card border-border hover:border-primary/30 transition-all cursor-pointer group"
                onClick={() => setSelectedIndustry(cache.industry)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg capitalize text-card-foreground group-hover:text-primary transition-colors">
                      {cache.industry}
                    </CardTitle>
                    {cache.isLocked ? (
                      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 shrink-0">
                        <Lock className="w-3 h-3 mr-1" /> Locked
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        <Unlock className="w-3 h-3 mr-1" /> Open
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Stats Row */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Database className="w-3.5 h-3.5" />
                      {keywords.length} keywords
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {cache.clientCount}/{cache.lockThreshold} clients
                    </span>
                    {goldenKeywords && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Crown className="w-3.5 h-3.5" />
                        {goldenKeywords.length} golden
                      </span>
                    )}
                  </div>

                  {/* Progress to lock */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Lock progress</span>
                      <span className="text-muted-foreground">
                        {cache.isLocked ? "Locked" : `${cache.clientCount}/${cache.lockThreshold}`}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          cache.isLocked ? "bg-amber-500" : "bg-primary"
                        }`}
                        style={{
                          width: `${Math.min(100, (cache.clientCount / cache.lockThreshold) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Top Keywords Preview */}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Top keywords:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {topKeywords.map((kw) => (
                        <Badge
                          key={kw.keyword}
                          variant="secondary"
                          className="text-xs font-normal"
                        >
                          {kw.keyword}
                          {kw.aiSearchVolume ? (
                            <span className="ml-1 text-primary">{kw.aiSearchVolume.toLocaleString()}</span>
                          ) : null}
                        </Badge>
                      ))}
                      {keywords.length > 5 && (
                        <Badge variant="outline" className="text-xs">
                          +{keywords.length - 5} more
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Total Volume */}
                  <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Total AI volume</span>
                    <span className="font-mono text-green-400 font-medium">{totalVolume.toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : caches && caches.length > 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-1">No matching industries</h3>
            <p className="text-sm text-muted-foreground">Try adjusting your search.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Database className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No cached industries yet</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              The keyword cache builds automatically as campaigns run keyword research.
              Each industry accumulates keywords across clients. Once the lock threshold is reached,
              a golden template is created and future campaigns skip the API call.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
