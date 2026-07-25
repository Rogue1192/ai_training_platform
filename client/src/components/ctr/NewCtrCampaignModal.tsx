import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin,
  Plus,
  X,
  TrendingUp,
  Shield,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Keyword {
  text: string;
  type: "primary" | "brand" | "local";
  weight: number;
}

const STEPS = [
  { id: 1, label: "Business" },
  { id: 2, label: "Location" },
  { id: 3, label: "Keywords" },
  { id: 4, label: "Ramp" },
  { id: 5, label: "Review" },
];

const KEYWORD_TYPE_COLORS = {
  primary: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  brand: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  local: "bg-green-500/15 text-green-400 border-green-500/30",
};

export function NewCtrCampaignModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(1);

  // Step 1 — Business
  const [businessName, setBusinessName] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [phone, setPhone] = useState("");

  // Step 2 — Location
  const [targetCity, setTargetCity] = useState("");
  const [targetCountry, setTargetCountry] = useState("US");
  const [gscSiteUrl, setGscSiteUrl] = useState("");

  // Step 3 — Keywords
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [kwType, setKwType] = useState<"primary" | "brand" | "local">("primary");

  // Step 4 — Ramp
  const [weeklyRampPct, setWeeklyRampPct] = useState(5);
  const [rampMode, setRampMode] = useState<"auto" | "manual">("auto");

  const createCampaign = trpc.ctr.createCampaign.useMutation({
    onSuccess: () => {
      toast.success("CTR campaign created");
      onCreated();
    },
    onError: (err) => toast.error(err.message),
  });

  function addKeyword() {
    const text = kwInput.trim();
    if (!text) return;
    if (keywords.find((k) => k.text.toLowerCase() === text.toLowerCase())) return;
    const newKws = [...keywords, { text, type: kwType, weight: 0 }];
    // Auto-distribute weights evenly
    const even = parseFloat((100 / newKws.length).toFixed(2));
    setKeywords(newKws.map((k) => ({ ...k, weight: even })));
    setKwInput("");
  }

  function removeKeyword(idx: number) {
    const newKws = keywords.filter((_, i) => i !== idx);
    if (newKws.length === 0) { setKeywords([]); return; }
    const even = parseFloat((100 / newKws.length).toFixed(2));
    setKeywords(newKws.map((k) => ({ ...k, weight: even })));
  }

  function handleSubmit() {
    createCampaign.mutate({
      businessName,
      mapsUrl,
      phone,
      targetCity,
      targetCountry,
      gscSiteUrl,
      weeklyRampPct,
      rampMode,
      keywords: keywords.map((k) => ({
        keyword: k.text,
        keywordType: k.type,
        weightPct: k.weight,
      })),
    });
  }

  const canAdvance = () => {
    if (step === 1) return businessName.trim().length > 0;
    if (step === 2) return targetCity.trim().length > 0;
    if (step === 3) return keywords.length > 0;
    if (step === 4) return true;
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New CTR Campaign</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1 flex-1">
              <div
                className={cn(
                  "flex-1 h-1.5 rounded-full transition-colors",
                  step > s.id ? "bg-primary" : step === s.id ? "bg-primary/60" : "bg-muted"
                )}
              />
              {i < STEPS.length - 1 && null}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground -mt-3 mb-4">
          Step {step} of {STEPS.length} — <span className="text-foreground font-medium">{STEPS[step - 1].label}</span>
        </p>

        {/* Step 1 — Business */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Business Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Eco Air Pros Heating & Cooling"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Google Maps URL</Label>
              <Input
                placeholder="https://maps.google.com/?cid=..."
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Paste the GBP listing URL from Google Maps</p>
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input
                placeholder="(407) 555-0100"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step 2 — Location & GSC */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Target City <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Orlando, FL"
                value={targetCity}
                onChange={(e) => setTargetCity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Target Country</Label>
              <Select value={targetCountry} onValueChange={setTargetCountry}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="CA">Canada</SelectItem>
                  <SelectItem value="GB">United Kingdom</SelectItem>
                  <SelectItem value="AU">Australia</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                GSC Site URL
                <Badge variant="outline" className="text-xs font-normal">Optional</Badge>
              </Label>
              <Input
                placeholder="https://ecoairpros.net/"
                value={gscSiteUrl}
                onChange={(e) => setGscSiteUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The exact property URL from your Google Search Console account. Used to pull baseline clicks for the ramp calculator.
              </p>
            </div>
          </div>
        )}

        {/* Step 3 — Keywords */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Add keyword..."
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                className="flex-1"
              />
              <Select value={kwType} onValueChange={(v) => setKwType(v as any)}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="brand">Brand</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={addKeyword} size="icon" variant="outline">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {keywords.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">No keywords added yet</p>
                <p className="text-xs text-muted-foreground mt-1">Add at least one keyword to continue</p>
              </div>
            ) : (
              <div className="space-y-2">
                {keywords.map((kw, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <span className="flex-1 text-sm">{kw.text}</span>
                    <Badge className={cn("text-xs", KEYWORD_TYPE_COLORS[kw.type])}>
                      {kw.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground w-10 text-right">
                      {kw.weight.toFixed(0)}%
                    </span>
                    <button
                      onClick={() => removeKeyword(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Weights are distributed evenly. You can adjust them on the campaign detail page.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 4 — Ramp */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="rounded-lg bg-muted/40 border p-4 flex items-start gap-3">
              <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Real Browser Only</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All sessions use real Chromium browsers. Headless mode is never used for GBP CTR.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Weekly Ramp Rate: <span className="text-primary font-semibold">{weeklyRampPct}%</span>
              </Label>
              <Slider
                min={3}
                max={7}
                step={0.5}
                value={[weeklyRampPct]}
                onValueChange={([v]) => setWeeklyRampPct(v)}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>3% (conservative)</span>
                <span>7% (aggressive)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Sessions increase by {weeklyRampPct}% each week from the GSC baseline. Stays within natural growth patterns.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Ramp Mode</Label>
              <Select value={rampMode} onValueChange={(v) => setRampMode(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (GSC-driven baseline)</SelectItem>
                  <SelectItem value="manual">Manual (set target directly)</SelectItem>
                </SelectContent>
              </Select>
              {rampMode === "auto" && gscSiteUrl && (
                <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
                  <CheckCircle2 className="h-3 w-3" />
                  GSC URL set — baseline will be pulled automatically
                </p>
              )}
              {rampMode === "auto" && !gscSiteUrl && (
                <p className="text-xs text-amber-400 flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3 w-3" />
                  No GSC URL set — ramp will start from 0 baseline
                </p>
              )}
            </div>
          </div>
        )}

        {/* Step 5 — Review */}
        {step === 5 && (
          <div className="space-y-3">
            <div className="rounded-lg border divide-y text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Business</span>
                <span className="font-medium">{businessName}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium">{targetCity}, {targetCountry}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Keywords</span>
                <span className="font-medium">{keywords.length} keywords</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Weekly Ramp</span>
                <span className="font-medium">{weeklyRampPct}%</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Ramp Mode</span>
                <span className="font-medium capitalize">{rampMode}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">GSC</span>
                <span className={gscSiteUrl ? "text-green-400 font-medium" : "text-amber-400 font-medium"}>
                  {gscSiteUrl || "Not connected"}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Browser Mode</span>
                <span className="text-green-400 font-medium flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Real Browser Only
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-4 pt-4 border-t">
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 5 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={!canAdvance()}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={createCampaign.isPending}
              className="gap-1"
            >
              {createCampaign.isPending ? "Creating..." : "Create Campaign"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
