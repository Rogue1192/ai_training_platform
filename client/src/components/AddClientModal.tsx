/**
 * AddClientModal
 *
 * Multi-step modal for adding a new client to an agency.
 * Collects all fields that feed the credibility content webhook payload.
 *
 * Steps:
 *   1. Business Info    — name, type, website, location, address, phone, description
 *   2. Contact Info     — contact name, email
 *   3. Credibility Data — years in business, certifications, licenses, awards, warranties, BBB, differentiators
 *   4. Social Profiles  — Facebook, Instagram, LinkedIn, YouTube, Yelp, Google Maps, BBB, Angie's, Thumbtack, Houzz
 *   5. Package & Billing — tier selection with 8-query-variation explanation + Stripe subscription note
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Building2, User, Shield, Share2, CreditCard,
  ChevronLeft, ChevronRight, Check, Info,
} from "lucide-react";

// ─── Package tier config ──────────────────────────────────────────────────────

const PACKAGES = [
  {
    value: "starter" as const,
    name: "Starter",
    price: "$179/mo",
    keywords: 5,
    locations: 3,
    totalSessions: 120,
    suggestedRetail: "$297–$347/mo",
    description: "5 keyword topics × 3 locations",
  },
  {
    value: "growth" as const,
    name: "Growth",
    price: "$249/mo",
    keywords: 5,
    locations: 5,
    totalSessions: 200,
    suggestedRetail: "$497/mo",
    description: "5 keyword topics × 5 locations",
  },
  {
    value: "pro" as const,
    name: "Pro",
    price: "$399/mo",
    keywords: 10,
    locations: 5,
    totalSessions: 400,
    suggestedRetail: "$797/mo",
    description: "10 keyword topics × 5 locations",
  },
];

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Business",    icon: Building2 },
  { id: 2, label: "Contact",     icon: User },
  { id: 3, label: "Credibility", icon: Shield },
  { id: 4, label: "Socials",     icon: Share2 },
  { id: 5, label: "Package",     icon: CreditCard },
];

// ─── Empty form state ─────────────────────────────────────────────────────────

const emptyForm = {
  // Step 1 — Business Info
  name: "",
  businessType: "",
  website: "",
  location: "",
  address: "",
  phone: "",
  description: "",
  notes: "",
  // Step 2 — Contact
  contactName: "",
  contactEmail: "",
  // Step 3 — Credibility
  yearsInBusiness: "",
  certifications: "",
  licenses: "",
  awards: "",
  warranties: "",
  bbbRating: "",
  differentiators: "",
  // Step 4 — Social profiles
  facebookUrl: "",
  instagramUrl: "",
  linkedinUrl: "",
  twitterUrl: "",
  youtubeUrl: "",
  tiktokUrl: "",
  yelpUrl: "",
  googleMapsUrl: "",
  bbbUrl: "",
  angiesUrl: "",
  thumbtackUrl: "",
  houzzUrl: "",
  // Step 5 — Package
  packageTier: "starter" as "starter" | "growth" | "pro",
};

type FormState = typeof emptyForm;

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
  agencyId: number;
  onSuccess?: (businessId: number) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddClientModal({
  open, onClose, agencyId, onSuccess,
}: AddClientModalProps) {
  const utils = trpc.useUtils();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>({ ...emptyForm });

  const addClientMutation = trpc.agency.addClient.useMutation({
    onSuccess: (data) => {
      toast.success("Client added successfully!");
      utils.agency.myClients.invalidate();
      utils.agency.getClients.invalidate({ agencyId });
      handleClose();
      onSuccess?.(data.businessId);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleClose = () => {
    setStep(1);
    setForm({ ...emptyForm });
    onClose();
  };

  const set = (field: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  // Validate required fields before advancing
  const canAdvance = (): boolean => {
    if (step === 1) return form.name.trim().length > 0;
    return true;
  };

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error("Business name is required"); return; }
    addClientMutation.mutate({
      agencyId,
      packageTier: form.packageTier,
      name: form.name.trim(),
      businessType: form.businessType || undefined,
      website: form.website || undefined,
      location: form.location || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
      description: form.description || undefined,
      notes: form.notes || undefined,
      contactName: form.contactName || undefined,
      contactEmail: form.contactEmail || undefined,
      yearsInBusiness: form.yearsInBusiness ? parseInt(form.yearsInBusiness, 10) : undefined,
      certifications: form.certifications || undefined,
      licenses: form.licenses || undefined,
      awards: form.awards || undefined,
      warranties: form.warranties || undefined,
      bbbRating: form.bbbRating || undefined,
      differentiators: form.differentiators || undefined,
      facebookUrl: form.facebookUrl || undefined,
      instagramUrl: form.instagramUrl || undefined,
      linkedinUrl: form.linkedinUrl || undefined,
      twitterUrl: form.twitterUrl || undefined,
      youtubeUrl: form.youtubeUrl || undefined,
      tiktokUrl: form.tiktokUrl || undefined,
      yelpUrl: form.yelpUrl || undefined,
      googleMapsUrl: form.googleMapsUrl || undefined,
      bbbUrl: form.bbbUrl || undefined,
      angiesUrl: form.angiesUrl || undefined,
      thumbtackUrl: form.thumbtackUrl || undefined,
      houzzUrl: form.houzzUrl || undefined,
    });
  };

  const selectedPackage = PACKAGES.find((p) => p.value === form.packageTier)!;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
          <DialogDescription>
            Complete all steps to onboard a new client. This information feeds the AI credibility content pipeline.
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
                <Label>Business Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Acme HVAC Services"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Industry / Business Type</Label>
                <Input
                  value={form.businessType}
                  onChange={(e) => set("businessType", e.target.value)}
                  placeholder="HVAC, Plumbing, Roofing…"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Website</Label>
                <Input
                  value={form.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="https://acmehvac.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Primary Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Dallas, TX"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(555) 555-5555"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Street Address</Label>
                <Input
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="123 Main St, Dallas, TX 75201"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Business Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Brief description of what this business does, who they serve, and their service area…"
                  rows={3}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Contact Info ── */}
        {step === 2 && (
          <div className="space-y-4">
            <SectionTitle icon={User} title="Contact Information" />
            <p className="text-sm text-muted-foreground">
              This contact info appears in the webhook payload sent to your platform and is used for client communications.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input
                  value={form.contactName}
                  onChange={(e) => set("contactName", e.target.value)}
                  placeholder="John Smith"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  placeholder="john@acmehvac.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Internal Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Any internal notes about this client (not shared with client)…"
                rows={3}
              />
            </div>
          </div>
        )}

        {/* ── Step 3: Credibility Data ── */}
        {step === 3 && (
          <div className="space-y-4">
            <SectionTitle icon={Shield} title="Credibility Data" />
            <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 flex gap-2 text-sm">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-blue-300">
                This data is used to generate trust-building content pages (certifications, awards, warranties, etc.)
                that train AI models to cite this business as a credible authority.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Years in Business</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.yearsInBusiness}
                  onChange={(e) => set("yearsInBusiness", e.target.value)}
                  placeholder="15"
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
                <Textarea
                  value={form.certifications}
                  onChange={(e) => set("certifications", e.target.value)}
                  placeholder="NATE Certified, EPA 608, ACCA Member…"
                  rows={2}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Licenses</Label>
                <Textarea
                  value={form.licenses}
                  onChange={(e) => set("licenses", e.target.value)}
                  placeholder="Texas HVAC License #12345, Fully Bonded & Insured…"
                  rows={2}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Awards & Recognition</Label>
                <Textarea
                  value={form.awards}
                  onChange={(e) => set("awards", e.target.value)}
                  placeholder="Angie's List Super Service Award 2022, 2023, 2024…"
                  rows={2}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Warranties & Guarantees</Label>
                <Textarea
                  value={form.warranties}
                  onChange={(e) => set("warranties", e.target.value)}
                  placeholder="10-year parts warranty, 1-year labor guarantee, 100% satisfaction guarantee…"
                  rows={2}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>What Sets Them Apart</Label>
                <Textarea
                  value={form.differentiators}
                  onChange={(e) => set("differentiators", e.target.value)}
                  placeholder="24/7 emergency service, same-day appointments, family-owned since 1998, bilingual staff…"
                  rows={2}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Social Profiles ── */}
        {step === 4 && (
          <div className="space-y-4">
            <SectionTitle icon={Share2} title="Social & Directory Profiles" />
            <p className="text-sm text-muted-foreground">
              These URLs are included in schema.org <code className="text-xs bg-muted px-1 rounded">sameAs</code> markup,
              which strengthens the business's entity footprint across AI knowledge graphs.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <SocialField label="Facebook" value={form.facebookUrl} onChange={(v) => set("facebookUrl", v)} placeholder="https://facebook.com/acmehvac" />
              <SocialField label="Instagram" value={form.instagramUrl} onChange={(v) => set("instagramUrl", v)} placeholder="https://instagram.com/acmehvac" />
              <SocialField label="LinkedIn" value={form.linkedinUrl} onChange={(v) => set("linkedinUrl", v)} placeholder="https://linkedin.com/company/acmehvac" />
              <SocialField label="YouTube" value={form.youtubeUrl} onChange={(v) => set("youtubeUrl", v)} placeholder="https://youtube.com/@acmehvac" />
              <SocialField label="TikTok" value={form.tiktokUrl} onChange={(v) => set("tiktokUrl", v)} placeholder="https://tiktok.com/@acmehvac" />
              <SocialField label="X / Twitter" value={form.twitterUrl} onChange={(v) => set("twitterUrl", v)} placeholder="https://x.com/acmehvac" />
              <SocialField label="Yelp" value={form.yelpUrl} onChange={(v) => set("yelpUrl", v)} placeholder="https://yelp.com/biz/acme-hvac" />
              <SocialField label="Google Maps / GMB" value={form.googleMapsUrl} onChange={(v) => set("googleMapsUrl", v)} placeholder="https://maps.google.com/?cid=…" />
              <SocialField label="BBB Profile" value={form.bbbUrl} onChange={(v) => set("bbbUrl", v)} placeholder="https://bbb.org/us/tx/dallas/profile/…" />
              <SocialField label="Angie's List" value={form.angiesUrl} onChange={(v) => set("angiesUrl", v)} placeholder="https://angi.com/companylist/…" />
              <SocialField label="Thumbtack" value={form.thumbtackUrl} onChange={(v) => set("thumbtackUrl", v)} placeholder="https://thumbtack.com/…" />
              <SocialField label="Houzz" value={form.houzzUrl} onChange={(v) => set("houzzUrl", v)} placeholder="https://houzz.com/pro/…" />
            </div>
          </div>
        )}

        {/* ── Step 5: Package & Billing ── */}
        {step === 5 && (
          <div className="space-y-4">
            <SectionTitle icon={CreditCard} title="Package & Billing" />

            {/* How keywords work */}
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2 text-sm">
              <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-amber-300 space-y-1">
                <p className="font-medium">How keyword topics work</p>
                <p>
                  Each keyword topic generates <strong>8 AI query variations</strong> targeting different
                  buyer-intent phrasings. For example, the keyword topic <em>"AC repair"</em> produces:
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-xs mt-1">
                  <li>"best AC repair in Dallas"</li>
                  <li>"top rated AC repair near me"</li>
                  <li>"affordable AC repair Dallas TX"</li>
                  <li>"AC repair company Dallas"</li>
                  <li>…and 4 more variations</li>
                </ul>
                <p className="text-xs mt-1">
                  Only <strong>commercial and transactional</strong> intent queries are used — informational
                  queries are excluded automatically.
                </p>
              </div>
            </div>

            {/* Tier cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PACKAGES.map((pkg) => {
                const isSelected = form.packageTier === pkg.value;
                return (
                  <button
                    key={pkg.value}
                    type="button"
                    onClick={() => set("packageTier", pkg.value)}
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
                    <p className="text-lg font-bold">{pkg.price}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {pkg.keywords} keywords × {pkg.locations} locations
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {pkg.totalSessions} AI training sessions/mo
                    </p>
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <p className="text-xs text-muted-foreground">Suggested retail:</p>
                      <p className="text-xs font-medium text-green-400">{pkg.suggestedRetail}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Billing summary */}
            <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
              <p className="font-medium">Billing Summary</p>
              <div className="flex justify-between text-muted-foreground">
                <span>{selectedPackage.name} plan — monthly</span>
                <span>{selectedPackage.price}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                A Stripe subscription will be created automatically on your agency account.
                The subscription starts immediately upon saving.
              </p>
            </div>
          </div>
        )}

        {/* Footer navigation */}
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <div className="flex gap-2 w-full sm:w-auto">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} className="flex-1 sm:flex-none">
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
            {step < STEPS.length ? (
              <Button
                onClick={() => {
                  if (!canAdvance()) { toast.error("Business name is required"); return; }
                  setStep((s) => s + 1);
                }}
                className="flex-1 sm:flex-none"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={addClientMutation.isPending}
                className="flex-1 sm:flex-none"
              >
                {addClientMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Client & Start Billing
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

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="font-semibold text-sm">{title}</h3>
    </div>
  );
}

function SocialField({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-xs h-8"
      />
    </div>
  );
}
