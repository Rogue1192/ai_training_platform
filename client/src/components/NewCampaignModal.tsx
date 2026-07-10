/**
 * NewCampaignModal
 *
 * Multi-step modal for manually creating a campaign from the admin Campaigns page.
 * Replicates the full GoHighLevel webhook onboarding flow without requiring GHL.
 *
 * Steps:
 *   1. Business Info    — name, website, industry, contact email/name/phone, specialties
 *   2. Locations        — up to 10 service area locations (city + state)
 *   3. Package & Settings — package tier, client type, billing type, agency, WP credentials
 *   4. Optional Queries — pre-fill search queries (or leave empty for auto keyword research)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Building2,
  MapPin,
  Package,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  Info,
  Plus,
  X,
  Rocket,
} from "lucide-react";

// ─── Package tier config ──────────────────────────────────────────────────────

const PACKAGES = [
  {
    value: "starter" as const,
    name: "Starter",
    maxQuerySlots: 15,
    totalSessions: 120,
    description: "15 AI training slots (5 keywords × 3 cities)",
    hint: "e.g. 5 keywords × 3 cities, or 15 keywords in 1 city",
  },
  {
    value: "growth" as const,
    name: "Growth",
    maxQuerySlots: 25,
    totalSessions: 200,
    description: "25 AI training slots (5 keywords × 5 cities)",
    hint: "e.g. 5 keywords × 5 cities, or 25 keywords in 1 city",
  },
  {
    value: "pro" as const,
    name: "Pro",
    maxQuerySlots: 50,
    totalSessions: 400,
    description: "50 AI training slots (10 keywords × 5 cities)",
    hint: "e.g. 10 keywords × 5 cities, or 50 keywords in 1 city",
  },
];

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Business", icon: Building2 },
  { id: 2, label: "Locations", icon: MapPin },
  { id: 3, label: "Package", icon: Package },
  { id: 4, label: "Queries", icon: Search },
];

// ─── Empty form state ─────────────────────────────────────────────────────────

const emptyForm = {
  // Step 1 — Business Info
  businessName: "",
  websiteUrl: "",
  industry: "",
  contactEmail: "",
  contactName: "",
  contactPhone: "",
  yearsFounded: "",
  bbbRating: "",
  certifications: "",
  awards: "",
  specialties: "",
  // Step 2 — Locations (up to 10)
  locations: ["", "", "", "", ""] as string[],
  // Step 3 — Package & Settings
  packageTierSlug: "starter" as "starter" | "growth" | "pro",
  campaignScope: "local" as "local" | "national" | "ecommerce",
  noCharge: false,
  clientType: "ai_only" as "ai_only" | "ai_plus_seo" | "ai_plus_seo_plus_build",
  billingType: "direct" as "direct" | "white_label" | "legacy",
  agencyId: "" as string,
  siteAdminUrl: "",
  siteUsername: "",
  sitePassword: "",
  source: "" as "" | "rogue" | "ranklocal",
  // Step 4 — Optional Queries
  searchQueriesRaw: "",
};

type FormState = typeof emptyForm;

// ─── Props ────────────────────────────────────────────────────────────────────

interface NewCampaignModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (campaignId: number) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewCampaignModal({
  open,
  onClose,
  onSuccess,
}: NewCampaignModalProps) {
  const utils = trpc.useUtils();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [createdInfo, setCreatedInfo] = useState<{
    campaignId: number;
    message: string;
    existing?: boolean;
  } | null>(null);

  // Agency list for dropdown
  const { data: agencies = [] } = trpc.agency.list.useQuery();

  const createMutation = trpc.campaign.createManual.useMutation({
    onSuccess: (data) => {
      utils.campaign.list.invalidate();
      utils.campaign.stats.invalidate();
      setCreatedInfo({
        campaignId: data.campaignId,
        message: data.message,
        existing: data.existing,
      });
    },
    onError: (err) => toast.error(err.message),
  });

  const handleClose = () => {
    setStep(1);
    setForm({ ...emptyForm });
    setCreatedInfo(null);
    onClose();
  };

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const setLoc = (idx: number, value: string) => {
    const next = [...form.locations];
    next[idx] = value;
    setForm((f) => ({ ...f, locations: next }));
  };

  const addLocationSlot = () => {
    if (form.locations.length < 10) {
      setForm((f) => ({ ...f, locations: [...f.locations, ""] }));
    }
  };

  const removeLocationSlot = (idx: number) => {
    if (form.locations.length <= 1) return;
    const next = form.locations.filter((_, i) => i !== idx);
    setForm((f) => ({ ...f, locations: next }));
  };

  // Validation per step
  const canAdvance = (): { ok: boolean; error?: string } => {
    if (step === 1) {
      if (!form.businessName.trim()) return { ok: false, error: "Business name is required" };
      if (!form.websiteUrl.trim()) return { ok: false, error: "Website URL is required" };
      if (!form.websiteUrl.startsWith("http")) return { ok: false, error: "Website URL must start with http:// or https://" };
      if (!form.contactEmail.trim()) return { ok: false, error: "Contact email is required" };
      if (!form.contactEmail.includes("@")) return { ok: false, error: "Enter a valid email address" };
    }
    if (step === 2) {
      // Locations are required for local scope only
      if (form.campaignScope === 'local') {
        const filled = form.locations.filter((l) => l.trim().length > 0);
        if (filled.length === 0) return { ok: false, error: "At least one location is required for local campaigns" };
      }
    }
    return { ok: true };
  };

  const handleNext = () => {
    const { ok, error } = canAdvance();
    if (!ok) {
      toast.error(error);
      return;
    }
    setStep((s) => s + 1);
  };

  const handleSubmit = () => {
    const filledLocations = form.locations.filter((l) => l.trim().length > 0);
    if (form.campaignScope === 'local' && filledLocations.length === 0) {
      toast.error("At least one location is required for local campaigns");
      return;
    }

    // Parse optional search queries (one per line)
    const searchQueries = form.searchQueriesRaw
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean);

    createMutation.mutate({
      businessName: form.businessName.trim(),
      websiteUrl: form.websiteUrl.trim(),
      industry: form.industry.trim() || undefined,
      contactEmail: form.contactEmail.trim(),
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      yearsFounded: form.yearsFounded ? parseInt(form.yearsFounded, 10) : undefined,
      bbbRating: form.bbbRating.trim() || undefined,
      certifications: form.certifications.trim()
        ? form.certifications.split(",").map((c) => c.trim()).filter(Boolean)
        : undefined,
      awards: form.awards.trim()
        ? form.awards.split(",").map((a) => a.trim()).filter(Boolean)
        : undefined,
      specialties: form.specialties.trim() || undefined,
      locations: filledLocations,
      campaignScope: form.campaignScope,
      packageTierSlug: form.packageTierSlug,
      clientType: form.clientType,
      billingType: form.billingType,
      agencyId: form.agencyId ? parseInt(form.agencyId, 10) : undefined,
      siteAdminUrl: form.siteAdminUrl.trim() || undefined,
      siteUsername: form.siteUsername.trim() || undefined,
      sitePassword: form.sitePassword.trim() || undefined,
      source: form.source || undefined,
      searchQueries: searchQueries.length > 0 ? searchQueries : undefined,
      noCharge: form.noCharge,
    });
  };

  const selectedPackage = PACKAGES.find((p) => p.value === form.packageTierSlug)!;
  const filledLocationCount = form.locations.filter((l) => l.trim().length > 0).length;

  // ── Success screen ──
  if (createdInfo) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="h-4 w-4 text-green-500" />
              </div>
              {createdInfo.existing ? "Campaign Found" : "Campaign Created!"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{createdInfo.message}</p>
            {!createdInfo.existing && (
              <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 flex gap-2 text-sm">
                <Rocket className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-blue-300">
                  The pipeline has been started automatically. The campaign will progress through
                  keyword research, query review, content generation, and training.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Campaign ID: <span className="font-mono text-foreground">{createdInfo.campaignId}</span>
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                onSuccess?.(createdInfo.campaignId);
                handleClose();
              }}
            >
              View Campaign
            </Button>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
          <DialogDescription>
            Create a campaign manually — same flow as the GHL webhook, directly from the dashboard.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 py-2">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = s.id === step;
            const isDone = s.id < step;
            return (
              <div key={s.id} className="flex items-center gap-1 flex-1">
                <button
                  className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isDone
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => isDone && setStep(s.id)}
                  disabled={!isDone && !isActive}
                >
                  {isDone ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`h-px flex-1 ${isDone ? "bg-primary/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Step 1: Business Info ── */}
        {step === 1 && (
          <div className="space-y-4">
            <SectionTitle icon={Building2} title="Business Information" />
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>
                  Business Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.businessName}
                  onChange={(e) => set("businessName", e.target.value)}
                  placeholder="Acme HVAC Services"
                  autoFocus
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>
                  Website URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.websiteUrl}
                  onChange={(e) => set("websiteUrl", e.target.value)}
                  placeholder="https://acmehvac.com"
                />
                <p className="text-xs text-muted-foreground">
                  If a campaign already exists for this URL, it will be returned instead of creating a duplicate.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Industry / Business Type</Label>
                <Input
                  value={form.industry}
                  onChange={(e) => set("industry", e.target.value)}
                  placeholder="HVAC, Plumbing, Roofing…"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Contact Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  placeholder="owner@acmehvac.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input
                  value={form.contactName}
                  onChange={(e) => set("contactName", e.target.value)}
                  placeholder="John Smith"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Phone</Label>
                <Input
                  value={form.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                  placeholder="(555) 555-5555"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Year Founded</Label>
                <Input
                  type="number"
                  min="1800"
                  max={new Date().getFullYear()}
                  value={form.yearsFounded}
                  onChange={(e) => set("yearsFounded", e.target.value)}
                  placeholder="2005"
                />
              </div>
              <div className="space-y-1.5">
                <Label>BBB Rating</Label>
                <Input
                  value={form.bbbRating}
                  onChange={(e) => set("bbbRating", e.target.value)}
                  placeholder="A+"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Certifications</Label>
                <Input
                  value={form.certifications}
                  onChange={(e) => set("certifications", e.target.value)}
                  placeholder="NATE Certified, EPA 608, ACCA Member (comma-separated)"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Awards & Recognition</Label>
                <Input
                  value={form.awards}
                  onChange={(e) => set("awards", e.target.value)}
                  placeholder="Angie's List Super Service Award 2022, 2023 (comma-separated)"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Specialties / Unique Expertise</Label>
                <Textarea
                  value={form.specialties}
                  onChange={(e) => set("specialties", e.target.value)}
                  placeholder="What makes this business unique? Emergency service, bilingual staff, 20+ years experience…"
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  This is emphasized in every AI training iteration.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Locations ── */}
        {step === 2 && (
          <div className="space-y-4">
            <SectionTitle icon={MapPin} title={form.campaignScope === 'local' ? 'Service Area Locations' : 'Target Markets (Optional)'} />
            <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 flex gap-2 text-sm">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-blue-300 space-y-1">
                {form.campaignScope === 'local' ? (
                  <>
                    <p className="font-medium">More locations = more AI coverage</p>
                    <p>
                      The AI trains on each location separately. With the{" "}
                      <strong>{selectedPackage.name}</strong> plan ({selectedPackage.maxQuerySlots} slots),
                      adding more cities spreads coverage across more markets.
                    </p>
                    <p className="text-xs">{selectedPackage.hint}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Optional: add specific markets or regions</p>
                    <p>
                      For {form.campaignScope === 'ecommerce' ? 'e-commerce' : 'national'} campaigns, location anchors are removed from AI queries.
                      You can optionally list key markets (e.g. "New York, NY") for reference — or leave all fields blank.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {form.locations.map((loc, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-7 w-7 rounded-full bg-muted text-xs font-medium text-muted-foreground shrink-0">
                    {idx + 1}
                  </div>
                  <Input
                    value={loc}
                    onChange={(e) => setLoc(idx, e.target.value)}
                    placeholder={form.campaignScope === 'local' ? `City, State — e.g. Dallas, TX` : `Market / region (optional) — e.g. New York, NY`}
                    className="flex-1"
                  />
                  {form.locations.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeLocationSlot(idx)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {form.locations.length < 10 && (
              <Button
                variant="outline"
                size="sm"
                onClick={addLocationSlot}
                className="w-full"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Location ({form.locations.length}/10)
              </Button>
            )}

            <div className="rounded-md border p-3 bg-muted/30 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Filled locations</span>
                <Badge variant="outline">
                  {filledLocationCount} / {form.locations.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-muted-foreground">Package slots</span>
                <Badge variant="outline">{selectedPackage.maxQuerySlots} total</Badge>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Package & Settings ── */}
        {step === 3 && (
          <div className="space-y-4">
            <SectionTitle icon={Package} title="Package & Settings" />

            {/* Campaign Scope selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Campaign Scope</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "local", label: "Local", desc: "City / region targeting" },
                  { value: "national", label: "National", desc: "Nationwide / agency" },
                  { value: "ecommerce", label: "E-Commerce", desc: "Online store / brand" },
                ] as const).map((s) => {
                  const isSel = form.campaignScope === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => set("campaignScope", s.value)}
                      className={`text-left rounded-lg border p-3 transition-all ${
                        isSel
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <p className="font-semibold text-sm">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.desc}</p>
                      {isSel && (
                        <div className="mt-1.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {form.campaignScope !== "local" && (
                <p className="text-xs text-amber-400">
                  Non-local scope: location fields become optional and AI training prompts will not include city/state anchors.
                </p>
              )}
            </div>

            {/* Package tier cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PACKAGES.map((pkg) => {
                const isSelected = form.packageTierSlug === pkg.value;
                return (
                  <button
                    key={pkg.value}
                    type="button"
                    onClick={() => set("packageTierSlug", pkg.value)}
                    className={`text-left rounded-lg border p-4 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="font-semibold text-sm">{pkg.name}</p>
                        <p className="text-xs text-muted-foreground">{pkg.description}</p>
                      </div>
                      {isSelected && (
                        <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-primary">{pkg.maxQuerySlots} query slots</p>
                    <p className="text-xs text-muted-foreground mt-1">{pkg.hint}</p>
                    <p className="text-xs text-muted-foreground">
                      {pkg.totalSessions} AI training sessions/mo
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Client Type</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.clientType}
                  onChange={(e) => set("clientType", e.target.value as FormState["clientType"])}
                >
                  <option value="ai_only">AI Only</option>
                  <option value="ai_plus_seo">AI + SEO</option>
                  <option value="ai_plus_seo_plus_build">AI + SEO + Build</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Billing Type</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.billingType}
                  onChange={(e) => set("billingType", e.target.value as FormState["billingType"])}
                >
                  <option value="direct">Direct (Retail)</option>
                  <option value="white_label">White Label (Agency)</option>
                  <option value="legacy">Legacy (Costs Only)</option>
                </select>
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label>Agency (optional)</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.agencyId}
                  onChange={(e) => set("agencyId", e.target.value)}
                >
                  <option value="">— No Agency (Direct Client) —</option>
                  {agencies.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* No Charge checkbox */}
              <div className="col-span-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={form.noCharge}
                    onChange={(e) => set("noCharge", e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary cursor-pointer"
                  />
                  <div>
                    <p className="text-sm font-medium leading-none group-hover:text-primary transition-colors">No Charge (Bundled)</p>
                    <p className="text-xs text-muted-foreground mt-1">This campaign is included in a larger package and should not be billed individually. Suppresses cost tracking and Stripe subscription creation.</p>
                  </div>
                </label>
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label>Internal Source Tag</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.source}
                  onChange={(e) => set("source", e.target.value as FormState["source"])}
                >
                  <option value="">— None —</option>
                  <option value="rogue">Rogue Business Marketing</option>
                  <option value="ranklocal">Rank Local</option>
                </select>
              </div>
            </div>

            {/* WordPress credentials (collapsible section) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  WordPress Auto-Publish Credentials (Optional)
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                If provided, the platform will auto-publish content pages directly to the client's WordPress site.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">WP Admin URL</Label>
                  <Input
                    value={form.siteAdminUrl}
                    onChange={(e) => set("siteAdminUrl", e.target.value)}
                    placeholder="https://acmehvac.com/wp-admin"
                    className="text-xs h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">WP Username</Label>
                  <Input
                    value={form.siteUsername}
                    onChange={(e) => set("siteUsername", e.target.value)}
                    placeholder="admin"
                    className="text-xs h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">WP Password / App Password</Label>
                  <Input
                    type="password"
                    value={form.sitePassword}
                    onChange={(e) => set("sitePassword", e.target.value)}
                    placeholder="••••••••"
                    className="text-xs h-8"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Optional Queries ── */}
        {step === 4 && (
          <div className="space-y-4">
            <SectionTitle icon={Search} title="Pre-fill Search Queries (Optional)" />

            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2 text-sm">
              <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-amber-300 space-y-1">
                <p className="font-medium">Leave blank for auto keyword research</p>
                <p>
                  If you leave this empty, the pipeline will automatically run keyword research
                  to generate optimized search queries for this business. You can review and approve
                  them before the campaign continues.
                </p>
                <p>
                  If you already know the target queries, enter one per line below. They will be
                  distributed across all {filledLocationCount} location{filledLocationCount !== 1 ? "s" : ""} up
                  to the {selectedPackage.maxQuerySlots}-slot budget.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Search Queries (one per line)</Label>
              <Textarea
                value={form.searchQueriesRaw}
                onChange={(e) => set("searchQueriesRaw", e.target.value)}
                placeholder={`AC repair Dallas\nbest HVAC company near me\nemergency AC service\n…`}
                rows={8}
                className="font-mono text-sm"
              />
              {form.searchQueriesRaw.trim() && (
                <p className="text-xs text-muted-foreground">
                  {form.searchQueriesRaw.split("\n").filter((q) => q.trim()).length} quer
                  {form.searchQueriesRaw.split("\n").filter((q) => q.trim()).length === 1 ? "y" : "ies"} entered
                  {filledLocationCount > 0 && (
                    <> · will be distributed across {filledLocationCount} location{filledLocationCount !== 1 ? "s" : ""}</>
                  )}
                  {" "}(max {selectedPackage.maxQuerySlots} slots)
                </p>
              )}
            </div>

            {/* Summary card */}
            <div className="rounded-md border p-4 bg-muted/30 space-y-2 text-sm">
              <p className="font-medium">Campaign Summary</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Business:</span>
                <span className="text-foreground font-medium truncate">{form.businessName || "—"}</span>
                <span>Website:</span>
                <span className="text-foreground truncate">{form.websiteUrl || "—"}</span>
                <span>Locations:</span>
                <span className="text-foreground">{filledLocationCount} filled</span>
                <span>Package:</span>
                <span className="text-foreground">{selectedPackage.name} ({selectedPackage.maxQuerySlots} slots)</span>
                <span>Client Type:</span>
                <span className="text-foreground">{form.clientType.replace(/_/g, " ")}</span>
                <span>Billing:</span>
                <span className="text-foreground">{form.billingType.replace(/_/g, " ")}</span>
                {form.agencyId && (
                  <>
                    <span>Agency:</span>
                    <span className="text-foreground">
                      {agencies.find((a: any) => String(a.id) === form.agencyId)?.name || `ID ${form.agencyId}`}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer navigation */}
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <div className="flex gap-2 w-full sm:w-auto">
            {step > 1 && (
              <Button
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
                className="flex-1 sm:flex-none"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
            {step < STEPS.length ? (
              <Button onClick={handleNext} className="flex-1 sm:flex-none">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending}
                className="flex-1 sm:flex-none"
              >
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Campaign
              </Button>
            )}
          </div>
          <Button variant="ghost" onClick={handleClose} className="sm:ml-auto">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: React.ElementType;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="font-semibold text-sm">{title}</h3>
    </div>
  );
}
