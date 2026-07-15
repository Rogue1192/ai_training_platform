import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Plus, RefreshCw, AlertTriangle, MapPin, Zap } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { parseLocations } from "../../../shared/location";

interface RegenerateQueriesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: number;
  /** Current business.location string (semicolon-separated) */
  currentLocation: string | null | undefined;
  /** Current business.specialties string (may be a long description — shown for reference only) */
  currentSpecialties: string | null | undefined;
  onSuccess?: () => void;
}

export function RegenerateQueriesModal({
  open,
  onOpenChange,
  campaignId,
  currentLocation,
  currentSpecialties,
  onSuccess,
}: RegenerateQueriesModalProps) {
  const utils = trpc.useUtils();

  // ── Location chips ──
  const [locations, setLocations] = useState<string[]>([]);
  const [locationInput, setLocationInput] = useState("");

  // ── Seed keyword chips ──
  const [seedKeywords, setSeedKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");

  // Seed state when modal opens
  useEffect(() => {
    if (open) {
      setLocations(parseLocations(currentLocation));
      setSeedKeywords([]);
      setLocationInput("");
      setKeywordInput("");
    }
  }, [open, currentLocation]);

  // ── Location helpers ──
  const addLocation = () => {
    const trimmed = locationInput.trim();
    if (!trimmed) return;
    if (locations.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("That location is already in the list.");
      return;
    }
    setLocations((prev) => [...prev, trimmed]);
    setLocationInput("");
  };

  const removeLocation = (idx: number) => {
    setLocations((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Keyword helpers ──
  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (!trimmed) return;
    if (seedKeywords.some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("That keyword is already in the list.");
      return;
    }
    setSeedKeywords((prev) => [...prev, trimmed]);
    setKeywordInput("");
  };

  const removeKeyword = (idx: number) => {
    setSeedKeywords((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Mutation ──
  const rerunMutation = trpc.campaign.rerunKeywordResearch.useMutation({
    onSuccess: (result: {
      queryLocationsCreated: number;
      deletedQueryCount: number;
      success: boolean;
      keywordsFound: number;
      usedCache: boolean;
      error?: string;
    }) => {
      toast.success(
        `Queries regenerated — ${result.queryLocationsCreated} new query-location pairs created (${result.deletedQueryCount} old ones removed).`,
        { duration: 6000 }
      );
      utils.campaign.getQueryLocations.invalidate({ campaignId });
      utils.campaign.get.invalidate({ id: campaignId });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err: { message: string }) => {
      toast.error(`Regeneration failed: ${err.message}`);
    },
  });

  const handleSubmit = () => {
    if (locations.length === 0) {
      toast.error("At least one location is required.");
      return;
    }

    const originalSet = new Set(parseLocations(currentLocation).map((l) => l.toLowerCase()));
    const additionalLocations = locations.filter((l) => !originalSet.has(l.toLowerCase()));

    rerunMutation.mutate({
      campaignId,
      additionalLocations: additionalLocations.length > 0 ? additionalLocations : undefined,
      // Pass the full clean keyword list so the backend can replace specialties
      seedKeywords: seedKeywords.length > 0 ? seedKeywords : undefined,
    });
  };

  const originalLocations = parseLocations(currentLocation);
  const newLocations = locations.filter(
    (l) => !originalLocations.some((o) => o.toLowerCase() === l.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            Regenerate Queries
          </DialogTitle>
          <DialogDescription>
            Update target locations and seed keywords, then regenerate the full query matrix using
            the latest query logic. Credibility data and content pages are not affected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Warning */}
          <div className="flex items-start gap-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 p-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300 leading-relaxed">
              This will <strong>delete all existing query-location pairs</strong> for this campaign
              and regenerate them from scratch. Training history and credibility data are preserved.
            </p>
          </div>

          {/* ── Target Locations ── */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-primary" />
              Target Locations
            </label>
            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 rounded-md border border-border bg-muted/30">
              {locations.map((loc, idx) => {
                const isNew = !originalLocations.some((o) => o.toLowerCase() === loc.toLowerCase());
                return (
                  <Badge
                    key={idx}
                    variant="outline"
                    className={`gap-1 pr-1 text-xs ${
                      isNew
                        ? "bg-green-500/10 text-green-400 border-green-500/30"
                        : "bg-muted text-foreground border-border"
                    }`}
                  >
                    {loc}
                    <button
                      onClick={() => removeLocation(idx)}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      disabled={rerunMutation.isPending}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                );
              })}
              {locations.length === 0 && (
                <span className="text-xs text-muted-foreground self-center">
                  No locations — add at least one below
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Riverside, CA"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLocation();
                  }
                }}
                className="h-8 text-sm"
                disabled={rerunMutation.isPending}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1"
                onClick={addLocation}
                disabled={!locationInput.trim() || rerunMutation.isPending}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
            {newLocations.length > 0 && (
              <p className="text-xs text-green-400">
                {newLocations.length} new location{newLocations.length !== 1 ? "s" : ""} will be
                added to the business profile.
              </p>
            )}
          </div>

          {/* ── Seed Keywords ── */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" />
              Seed Keywords
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Add specific services or terms to guide keyword research. These replace any existing
              specialties on the business profile.
            </p>
            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 rounded-md border border-border bg-muted/30">
              {seedKeywords.map((kw, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="gap-1 pr-1 text-xs bg-blue-500/10 text-blue-300 border-blue-500/30"
                >
                  {kw}
                  <button
                    onClick={() => removeKeyword(idx)}
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    disabled={rerunMutation.isPending}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </Badge>
              ))}
              {seedKeywords.length === 0 && (
                <span className="text-xs text-muted-foreground self-center">
                  No seed keywords added yet
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. mini-split installation"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                className="h-8 text-sm"
                disabled={rerunMutation.isPending}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1"
                onClick={addKeyword}
                disabled={!keywordInput.trim() || rerunMutation.isPending}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={rerunMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleSubmit}
              disabled={rerunMutation.isPending || locations.length === 0}
            >
              {rerunMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Regenerating…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate Queries
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
