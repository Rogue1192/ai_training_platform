/**
 * TrainingQuerySetup.tsx
 *
 * Step 1 of V3 training setup: fetch keyword candidates from DataForSEO,
 * review/edit them, generate variations, then lock and start the sprint.
 *
 * States:
 *   no_queries    → Show "Fetch Candidates" button
 *   has_candidates → Show editable list with "Generate Variations" button
 *   has_variations → Show phrases + variations with "Lock & Start Sprint" button
 *   locked        → Show read-only list, link to dashboard
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Search,
  Loader2,
  Lock,
  Unlock,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Sparkles,
  Rocket,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  campaignId: number;
  onSprintStarted?: () => void;
}

export function TrainingQuerySetup({ campaignId, onSprintStarted }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: queries, refetch: refetchQueries, isLoading } = trpc.trainingQuery.getQueries.useQuery({ campaignId });

  const fetchCandidatesMutation = trpc.trainingQuery.fetchCandidates.useMutation({
    onSuccess: async (data) => {
      // Save the candidates
      await saveQueriesMutation.mutateAsync({
        campaignId,
        phrases: data.candidates,
      });
      toast.success(`${data.candidates.length} keyword phrases fetched and saved`);
      refetchQueries();
    },
    onError: (err) => toast.error(`Failed to fetch candidates: ${err.message}`),
  });

  const saveQueriesMutation = trpc.trainingQuery.saveQueries.useMutation();

  const generateVariationsMutation = trpc.trainingQuery.generateVariations.useMutation({
    onSuccess: (data) => {
      toast.success(`Variations generated for ${data.generated} phrases`);
      refetchQueries();
    },
    onError: (err) => toast.error(`Failed to generate variations: ${err.message}`),
  });

  const lockQueriesMutation = trpc.trainingQuery.lockQueries.useMutation({
    onSuccess: () => {
      toast.success("Phrases locked! 4-day sprint scheduled.");
      refetchQueries();
      onSprintStarted?.();
    },
    onError: (err) => toast.error(`Failed to lock: ${err.message}`),
  });

  const updatePhraseMutation = trpc.trainingQuery.updatePhrase.useMutation({
    onSuccess: () => refetchQueries(),
    onError: (err) => toast.error(err.message),
  });

  const deletePhraseMutation = trpc.trainingQuery.deletePhrase.useMutation({
    onSuccess: () => {
      toast.success("Phrase removed");
      refetchQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasQueries = queries && queries.length > 0;
  const isLocked = hasQueries && queries.every((q) => !!q.lockedAt);
  const hasVariations = hasQueries && queries.every((q) => (q.phraseVariations as string[])?.length > 0);
  const unlockedCount = queries?.filter((q) => !q.lockedAt).length ?? 0;

  // ─── Empty state ───────────────────────────────────────────────────────────
  if (!hasQueries) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Search className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-foreground">Set Up Training Queries</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Fetch keyword phrases from DataForSEO based on this business's type, specialties, and location.
              You'll review and edit them before locking in.
            </p>
          </div>
          <Button
            onClick={() => fetchCandidatesMutation.mutate({ campaignId })}
            disabled={fetchCandidatesMutation.isPending}
            className="mt-2"
          >
            {fetchCandidatesMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Fetching Candidates...</>
            ) : (
              <><Search className="w-4 h-4 mr-2" />Fetch Keyword Candidates</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── Locked state ──────────────────────────────────────────────────────────
  if (isLocked) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Lock className="w-4 h-4 text-green-400" />
              Training Queries — Locked
            </CardTitle>
            <Badge variant="outline" className="text-green-400 border-green-400/30 bg-green-400/10">
              {queries.length} phrases locked
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {queries.map((q, i) => (
            <div key={q.id} className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                    <span className="text-sm text-foreground font-medium">{q.phraseText}</span>
                    {q.aiSearchVolume ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {q.aiSearchVolume.toLocaleString()} AI searches/mo
                      </Badge>
                    ) : null}
                  </div>
                  {/* Variations */}
                  {(q.phraseVariations as string[])?.length > 0 && (
                    <div className="mt-2 ml-7 space-y-1">
                      {(q.phraseVariations as string[]).map((v, vi) => (
                        <div key={vi} className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-full bg-primary/30 flex-shrink-0" />
                          {v}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // ─── Review / Edit state ───────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header actions */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Unlock className="w-4 h-4 text-amber-400" />
              Review & Edit Training Phrases
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchCandidatesMutation.mutate({ campaignId })}
                disabled={fetchCandidatesMutation.isPending || generateVariationsMutation.isPending}
              >
                {fetchCandidatesMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                Re-fetch
              </Button>
              {!hasVariations && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => generateVariationsMutation.mutate({ campaignId })}
                  disabled={generateVariationsMutation.isPending || unlockedCount === 0}
                >
                  {generateVariationsMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating...</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate Variations</>
                  )}
                </Button>
              )}
              {hasVariations && (
                <Button
                  size="sm"
                  onClick={() => lockQueriesMutation.mutate({ campaignId })}
                  disabled={lockQueriesMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {lockQueriesMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Locking...</>
                  ) : (
                    <><Rocket className="w-3.5 h-3.5 mr-1.5" />Lock & Start Sprint</>
                  )}
                </Button>
              )}
            </div>
          </div>
          {!hasVariations && (
            <p className="text-xs text-muted-foreground mt-1">
              Review and edit phrases below, then click "Generate Variations" to create 3 natural-language variations per phrase.
              Once you're happy, click "Lock & Start Sprint" to begin the 4-day training sprint.
            </p>
          )}
          {hasVariations && (
            <p className="text-xs text-amber-400 mt-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Variations generated. Review them below, then lock to start the sprint. Phrases cannot be edited after locking.
            </p>
          )}
        </CardHeader>
      </Card>

      {/* Phrase list */}
      <div className="space-y-2">
        {queries.map((q, i) => {
          const isExpanded = expandedIds.has(q.id);
          const variations = (q.phraseVariations as string[]) ?? [];

          return (
            <Card key={q.id} className="bg-card border-border">
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground w-5 pt-1 flex-shrink-0">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    {editingId === q.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="h-7 text-sm"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => {
                            updatePhraseMutation.mutate({ queryId: q.id, phraseText: editText });
                            setEditingId(null);
                          }}
                          disabled={updatePhraseMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-sm text-foreground font-medium cursor-pointer hover:text-primary transition-colors"
                          onClick={() => {
                            setEditingId(q.id);
                            setEditText(q.phraseText);
                          }}
                        >
                          {q.phraseText}
                        </span>
                        {q.aiSearchVolume ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {q.aiSearchVolume.toLocaleString()} AI searches/mo
                          </Badge>
                        ) : null}
                      </div>
                    )}

                    {/* Variations */}
                    {variations.length > 0 && (
                      <div className="mt-2">
                        <button
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => {
                            const next = new Set(expandedIds);
                            if (isExpanded) next.delete(q.id);
                            else next.add(q.id);
                            setExpandedIds(next);
                          }}
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {variations.length} variation{variations.length !== 1 ? "s" : ""}
                        </button>
                        {isExpanded && (
                          <div className="mt-1.5 ml-3 space-y-1">
                            {variations.map((v, vi) => (
                              <div key={vi} className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-primary/30 flex-shrink-0" />
                                {v}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!q.lockedAt && editingId !== q.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 flex-shrink-0"
                      onClick={() => deletePhraseMutation.mutate({ queryId: q.id })}
                      disabled={deletePhraseMutation.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
