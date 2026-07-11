/**
 * NewCampaignModal — redesigned
 *
 * Flow (3 steps):
 *   1. Select Business  — searchable combobox from existing Businesses records
 *   2. Locations & Tier — checkboxes from the business's stored locations + scope + tier cards
 *                         (billing section hidden when business.noCharge is true)
 *   3. Queries          — AI pre-populated from industry keyword cache; user may edit
 */
import { useState, useMemo } from "react";
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
  Rocket,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Package tier config ──────────────────────────────────────────────────────

const PACKAGES = [
  {
    value: "starter" as const,
    name: "Starter",
    maxQuerySlots: 15,
    totalSessions: 120,
    description: "15 AI training slots",
    hint: "e.g. 5 keywords × 3 cities, or 15 keywords in 1 city",
  },
  {
    value: "growth" as const,
    name: "Growth",
    maxQuerySlots: 25,
    totalSessions: 200,
    description: "25 AI training slots",
    hint: "e.g. 5 keywords × 5 cities, or 25 keywords in 1 city",
  },
  {
    value: "pro" as const,
    name: "Pro",
    maxQuerySlots: 50,
    totalSessions: 400,
    description: "50 AI training slots",
    hint: "e.g. 10 keywords × 5 cities, or 50 keywords in 1 city",
  },
];

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Business", icon: Building2 },
  { id: 2, label: "Locations & Tier", icon: MapPin },
  { id: 3, label: "Queries", icon: Search },
];

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

  // ── Step state ──
  const [step, setStep] = useState(1);

  // ── Step 1: selected business ──
  const [businessSearch, setBusinessSearch] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [comboOpen, setComboOpen] = useState(false);

  // ── Step 2: locations + tier + scope ──
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [packageTierSlug, setPackageTierSlug] = useState<"starter" | "growth" | "pro">("starter");
  const [campaignScope, setCampaignScope] = useState<"local" | "national" | "ecommerce">("local");
  const [billingType, setBillingType] = useState<"direct" | "white_label" | "legacy">("direct");
  const [agencyId, setAgencyId] = useState("");
  const [source, setSource] = useState<"" | "rogue" | "ranklocal">("");

  // ── Step 3: queries ──
  const [searchQueriesRaw, setSearchQueriesRaw] = useState("");
  const [queriesLoaded, setQueriesLoaded] = useState(false);

  // ── Success screen ──
  const [createdInfo, setCreatedInfo] = useState<{
    campaignId: number;
    message: string;
    existing?: boolean;
  } | null>(null);

  // ── Data queries ──
  const { data: businesses = [] } = trpc.business.list.useQuery();
  const { data: agencies = [] } = trpc.agency.list.useQuery();

  // Selected business record
  const selectedBusiness = useMemo(
    () => businesses.find((b: any) => b.id === selectedBusinessId) ?? null,
    [businesses, selectedBusinessId]
  );

  // Parse locations from the selected business
  const businessLocations = useMemo((): string[] => {
    if (!selectedBusiness) return [];
    const raw: string = (selectedBusiness as any).location || "";
    if (!raw.trim()) return [];
    // Support both semicolon-separated and newline-separated formats
    return raw
      .split(/[;\n]/)
      .map((l: string) => l.trim())
      .filter(Boolean);
  }, [selectedBusiness]);

  // Industry keyword cache for AI query pre-population
  const industry = (selectedBusiness as any)?.businessType?.trim() || "";
  const { data: industryCache } = trpc.industryCache.get.useQuery(
    { industry: industry.toLowerCase() },
    { enabled: !!industry && step === 3 }
  );

  // Filtered business list for combobox
  const filteredBusinesses = useMemo(() => {
    const q = businessSearch.toLowerCase();
    return (businesses as any[]).filter(
      (b) =>
        !b.isArchived &&
        (b.name?.toLowerCase().includes(q) ||
          b.website?.toLowerCase().includes(q) ||
          b.businessType?.toLowerCase().includes(q))
    );
  }, [businesses, businessSearch]);

  const selectedPackage = PACKAGES.find((p) => p.value === packageTierSlug)!;
  const isNoCharge = !!(selectedBusiness as any)?.noCharge;

  // ── Mutation ──
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

  // ── Handlers ──
  const handleClose = () => {
    setStep(1);
    setBusinessSearch("");
    setSelectedBusinessId(null);
    setComboOpen(false);
    setSelectedLocations([]);
    setPackageTierSlug("starter");
    setCampaignScope("local");
    setBillingType("direct");
    setAgencyId("");
    setSource("");
    setSearchQueriesRaw("");
    setQueriesLoaded(false);
    setCreatedInfo(null);
    onClose();
  };

  const toggleLocation = (loc: string) => {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  };

  // When advancing to step 3, pre-populate queries from the industry cache
  const handleAdvanceToStep3 = () => {
    if (!queriesLoaded && industryCache) {
      const keywords: any[] = (industryCache as any).goldenTemplateKeywords ||
        (industryCache as any).keywords || [];
      if (keywords.length > 0) {
        const lines = keywords
          .slice(0, selectedPackage.maxQuerySlots)
          .map((k: any) => (typeof k === "string" ? k : k.keyword || ""))
          .filter(Boolean)
          .join("\n");
        setSearchQueriesRaw(lines);
        setQueriesLoaded(true);
      }
    }
    setStep(3);
  };

  const canAdvance = (): { ok: boolean; error?: string } => {
    if (step === 1) {
      if (!selectedBusinessId) return { ok: false, error: "Please select a business" };
    }
    if (step === 2) {
      if (campaignScope === "local" && selectedLocations.length === 0) {
        return { ok: false, error: "Select at least one location for a local campaign" };
      }
    }
    return { ok: true };
  };

  const handleNext = () => {
    const { ok, error } = canAdvance();
    if (!ok) { toast.error(error); return; }
    if (step === 2) {
      handleAdvanceToStep3();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleSubmit = () => {
    if (!selectedBusinessId) { toast.error("No business selected"); return; }
    if (campaignScope === "local" && selectedLocations.length === 0) {
      toast.error("Select at least one location");
      return;
    }

    const searchQueries = searchQueriesRaw
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean);

    createMutation.mutate({
      businessId: selectedBusinessId,
      locations: selectedLocations.length > 0 ? selectedLocations : undefined,
      packageTierSlug,
      campaignScope,
      billingType: isNoCharge ? undefined : billingType,
      agencyId: agencyId ? parseInt(agencyId, 10) : undefined,
      source: source || undefined,
      searchQueries: searchQueries.length > 0 ? searchQueries : undefined,
      noCharge: isNoCharge,
    });
  };

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
            <Button onClick={() => { onSuccess?.(createdInfo.campaignId); handleClose(); }}>
              View Campaign
            </Button>
            <Button variant="outline" onClick={handleClose}>Close</Button>
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
            Select an existing business and configure the campaign settings.
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
                  {isDone ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`h-px flex-1 ${isDone ? "bg-primary/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Step 1: Select Business ── */}
        {step === 1 && (
          <div className="space-y-4">
            <SectionTitle icon={Building2} title="Select Business" />

            <div className="space-y-2">
              <Label>Business <span className="text-destructive">*</span></Label>

              {/* Searchable combobox */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setComboOpen((o) => !o)}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <span className={selectedBusiness ? "text-foreground" : "text-muted-foreground"}>
                    {selectedBusiness
                      ? `${(selectedBusiness as any).name} — ${(selectedBusiness as any).website || "no website"}`
                      : "Search and select a business…"}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </button>

                {comboOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="p-2 border-b">
                      <Input
                        autoFocus
                        placeholder="Search by name, website, or type…"
                        value={businessSearch}
                        onChange={(e) => setBusinessSearch(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                      {filteredBusinesses.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">No businesses found.</p>
                      ) : (
                        filteredBusinesses.map((b: any) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => {
                              setSelectedBusinessId(b.id);
                              setBusinessSearch("");
                              setComboOpen(false);
                              // Reset downstream selections when business changes
                              setSelectedLocations([]);
                              setQueriesLoaded(false);
                              setSearchQueriesRaw("");
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-start gap-2",
                              selectedBusinessId === b.id && "bg-accent/60"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{b.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {b.website || "—"} · {b.businessType || "Unknown type"}
                              </p>
                            </div>
                            {selectedBusinessId === b.id && (
                              <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Selected business preview card */}
            {selectedBusiness && (
              <div className="rounded-md border p-4 bg-muted/30 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{(selectedBusiness as any).name}</span>
                  {isNoCharge && (
                    <Badge variant="outline" className="text-xs border-green-500/50 text-green-400">
                      No Charge
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Website:</span>
                  <span className="text-foreground truncate">{(selectedBusiness as any).website || "—"}</span>
                  <span>Type:</span>
                  <span className="text-foreground">{(selectedBusiness as any).businessType || "—"}</span>
                  <span>Contact:</span>
                  <span className="text-foreground">{(selectedBusiness as any).contactEmail || "—"}</span>
                  <span>Locations:</span>
                  <span className="text-foreground">{businessLocations.length} stored</span>
                </div>
                {businessLocations.length === 0 && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300 flex gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    This business has no locations yet. Add them in the Businesses tab first, or you can proceed and the pipeline will use keyword research only.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Locations & Tier ── */}
        {step === 2 && selectedBusiness && (
          <div className="space-y-5">

            {/* Campaign Scope */}
            <div className="space-y-2">
              <SectionTitle icon={MapPin} title="Campaign Scope" />
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "local", label: "Local", desc: "City / region targeting" },
                  { value: "national", label: "National", desc: "Nationwide / agency" },
                  { value: "ecommerce", label: "E-Commerce", desc: "Online store / brand" },
                ] as const).map((s) => {
                  const isSel = campaignScope === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setCampaignScope(s.value)}
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
            </div>

            {/* Locations from business */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Target Locations
                {campaignScope === "local" && <span className="text-destructive ml-1">*</span>}
              </Label>
              {businessLocations.length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Select the locations from this business to include in the campaign.
                  </p>
                  <div className="space-y-1.5">
                    {businessLocations.map((loc) => {
                      const checked = selectedLocations.includes(loc);
                      return (
                        <label
                          key={loc}
                          className="flex items-center gap-3 rounded-md border p-2.5 cursor-pointer hover:bg-accent/40 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLocation(loc)}
                            className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                          />
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm truncate">{loc}</span>
                          </div>
                          {checked && (
                            <Badge variant="outline" className="text-xs border-primary/50 text-primary shrink-0">
                              Selected
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span>{selectedLocations.length} of {businessLocations.length} selected</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setSelectedLocations([...businessLocations])}
                      >
                        Select all
                      </button>
                      <span>·</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:underline"
                        onClick={() => setSelectedLocations([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex gap-2">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  No locations are stored for this business. The pipeline will run keyword research
                  without location anchors. You can add locations in the Businesses tab at any time.
                </div>
              )}
            </div>

            {/* Package tier cards */}
            <div className="space-y-2">
              <SectionTitle icon={Package} title="Package Tier" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PACKAGES.map((pkg) => {
                  const isSelected = packageTierSlug === pkg.value;
                  return (
                    <button
                      key={pkg.value}
                      type="button"
                      onClick={() => setPackageTierSlug(pkg.value)}
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
                      <p className="text-xs text-muted-foreground">{pkg.totalSessions} AI training sessions/mo</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Billing — hidden when business is marked No Charge */}
            {!isNoCharge ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Billing Type</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={billingType}
                    onChange={(e) => setBillingType(e.target.value as typeof billingType)}
                  >
                    <option value="direct">Direct (Retail)</option>
                    <option value="white_label">White Label (Agency)</option>
                    <option value="legacy">Legacy (Costs Only)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Agency (optional)</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={agencyId}
                    onChange={(e) => setAgencyId(e.target.value)}
                  >
                    <option value="">— No Agency —</option>
                    {(agencies as any[]).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm flex gap-2">
                <Check className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                <div className="text-green-300">
                  <p className="font-medium">No Charge — Bundled</p>
                  <p className="text-xs mt-0.5">
                    This business is marked as bundled/no-charge. Billing settings are suppressed and
                    Stripe subscription creation will be skipped for this campaign.
                  </p>
                </div>
              </div>
            )}

            {/* Internal Source */}
            <div className="space-y-1.5">
              <Label>Internal Source Tag</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
              >
                <option value="">— None —</option>
                <option value="rogue">Rogue Business Marketing</option>
                <option value="ranklocal">Rank Local</option>
              </select>
            </div>


          </div>
        )}

        {/* ── Step 3: Queries ── */}
        {step === 3 && (
          <div className="space-y-4">
            <SectionTitle icon={Search} title="Search Queries" />

            <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 flex gap-2 text-sm">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-blue-300 space-y-1">
                {industryCache && searchQueriesRaw.trim() ? (
                  <>
                    <p className="font-medium">AI-suggested queries pre-loaded</p>
                    <p>
                      These queries were pre-populated from the{" "}
                      <strong>{(selectedBusiness as any)?.businessType || "industry"}</strong> keyword
                      cache. Review and edit them as needed, or clear the field to let the pipeline
                      run automatic keyword research.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Leave blank for auto keyword research</p>
                    <p>
                      If you leave this empty, the pipeline will automatically run keyword research
                      to generate optimized search queries. You can review and approve them before
                      the campaign continues.
                    </p>
                    {industry && !industryCache && (
                      <p className="text-xs text-blue-200/70">
                        No keyword cache found for "{industry}" yet — queries will be generated automatically.
                      </p>
                    )}
                  </>
                )}
                <p>
                  Queries will be distributed across {selectedLocations.length || "all"}{" "}
                  location{selectedLocations.length !== 1 ? "s" : ""} up to the{" "}
                  {selectedPackage.maxQuerySlots}-slot budget.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Search Queries (one per line)</Label>
              <Textarea
                value={searchQueriesRaw}
                onChange={(e) => setSearchQueriesRaw(e.target.value)}
                placeholder={`AC repair Dallas\nbest HVAC company near me\nemergency AC service\n…`}
                rows={10}
                className="font-mono text-sm"
              />
              {searchQueriesRaw.trim() && (
                <p className="text-xs text-muted-foreground">
                  {searchQueriesRaw.split("\n").filter((q) => q.trim()).length} quer
                  {searchQueriesRaw.split("\n").filter((q) => q.trim()).length === 1 ? "y" : "ies"} entered
                  {selectedLocations.length > 0 && (
                    <> · distributed across {selectedLocations.length} location{selectedLocations.length !== 1 ? "s" : ""}</>
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
                <span className="text-foreground font-medium truncate">
                  {(selectedBusiness as any)?.name || "—"}
                </span>
                <span>Industry:</span>
                <span className="text-foreground">{(selectedBusiness as any)?.businessType || "—"}</span>
                <span>Locations:</span>
                <span className="text-foreground">{selectedLocations.length} selected</span>
                <span>Scope:</span>
                <span className="text-foreground capitalize">{campaignScope}</span>
                <span>Package:</span>
                <span className="text-foreground">{selectedPackage.name} ({selectedPackage.maxQuerySlots} slots)</span>
                <span>Billing:</span>
                <span className="text-foreground">
                  {isNoCharge ? "No Charge (Bundled)" : billingType.replace(/_/g, " ")}
                </span>
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
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
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
