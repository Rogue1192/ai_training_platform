/**
 * ClientIntakeForm — public branded onboarding form for white-label agency clients.
 *
 * Route: /intake/:token  (no auth required)
 *
 * Flow:
 *  1. Load agency branding via token (name, logo)
 *  2. Client fills out multi-step form (business info → contact → credibility → socials)
 *  3. On submit → createBusiness linked to agency, agencyPackageTier = null (pending)
 *  4. Agency gets notified; they log in and assign the tier to kick off the campaign
 */
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2, User, Award, Share2,
  CheckCircle, Loader2, ChevronRight, ChevronLeft,
  Globe, Phone, MapPin, Mail, Star,
} from "lucide-react";

// ─── Step definitions ────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Business Info",  icon: Building2 },
  { id: 2, label: "Contact",        icon: User },
  { id: 3, label: "Credibility",    icon: Award },
  { id: 4, label: "Social Profiles",icon: Share2 },
] as const;

type StepId = (typeof STEPS)[number]["id"];

// ─── Form state ──────────────────────────────────────────────────────────────

interface FormData {
  // Step 1 — Business
  name: string;
  businessType: string;
  website: string;
  location: string;
  address: string;
  phone: string;
  description: string;
  // Step 2 — Contact
  contactName: string;
  contactEmail: string;
  // Step 3 — Credibility
  yearsInBusiness: string;
  certifications: string;
  licenses: string;
  awards: string;
  warranties: string;
  bbbRating: string;
  differentiators: string;
  // Step 4 — Socials
  facebookUrl: string;
  instagramUrl: string;
  linkedinUrl: string;
  twitterUrl: string;
  youtubeUrl: string;
  tiktokUrl: string;
  yelpUrl: string;
  googleMapsUrl: string;
  bbbUrl: string;
  angiesUrl: string;
  thumbtackUrl: string;
  houzzUrl: string;
}

const EMPTY_FORM: FormData = {
  name: "", businessType: "", website: "", location: "", address: "", phone: "", description: "",
  contactName: "", contactEmail: "",
  yearsInBusiness: "", certifications: "", licenses: "", awards: "", warranties: "", bbbRating: "", differentiators: "",
  facebookUrl: "", instagramUrl: "", linkedinUrl: "", twitterUrl: "", youtubeUrl: "", tiktokUrl: "",
  yelpUrl: "", googleMapsUrl: "", bbbUrl: "", angiesUrl: "", thumbtackUrl: "", houzzUrl: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ClientIntakeForm() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const [step, setStep] = useState<StepId>(1);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load agency branding (public — no auth)
  const brandingQuery = trpc.agency.getIntakeBranding.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const submitMutation = trpc.agency.submitIntakeForm.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => setError(err.message),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  const set = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const canAdvance = (): boolean => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) return form.contactName.trim().length > 0 && form.contactEmail.trim().length > 0;
    return true;
  };

  const handleSubmit = () => {
    setError(null);
    submitMutation.mutate({
      token,
      name: form.name.trim(),
      businessType: form.businessType || undefined,
      website: form.website || undefined,
      location: form.location || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
      description: form.description || undefined,
      contactName: form.contactName || undefined,
      contactEmail: form.contactEmail || undefined,
      yearsInBusiness: form.yearsInBusiness ? parseInt(form.yearsInBusiness) : undefined,
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

  // ── Loading / error states ────────────────────────────────────────────────

  if (brandingQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (brandingQuery.isError || !brandingQuery.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="text-red-500 mb-3 text-4xl">⚠️</div>
            <h2 className="text-xl font-semibold mb-2">Invalid Link</h2>
            <p className="text-gray-500 text-sm">
              This onboarding link is invalid or has expired. Please contact your agency for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const branding = brandingQuery.data;

  // ── Success screen ────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-10 pb-10 text-center">
            <CheckCircle className="h-14 w-14 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              Your information has been submitted to <strong>{branding.brandName}</strong>.
              They'll be in touch shortly to get your campaign started.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header / Branding */}
        <div className="text-center mb-8">
          {branding.brandLogoUrl ? (
            <img
              src={branding.brandLogoUrl}
              alt={branding.brandName}
              className="h-14 mx-auto mb-3 object-contain"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-blue-600 flex items-center justify-center mx-auto mb-3">
              <Building2 className="h-7 w-7 text-white" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">{branding.brandName}</h1>
          <p className="text-gray-500 text-sm mt-1">Client Onboarding — tell us about your business</p>
        </div>

        {/* Step progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = s.id === step;
            const isDone = s.id < step;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : isDone
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                  <span className="sm:hidden">{s.id}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                )}
              </div>
            );
          })}
        </div>

        {/* Form card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => { const S = STEPS[step - 1]!; const Icon = S.icon; return <Icon className="h-5 w-5 text-blue-600" />; })()}
              {STEPS[step - 1]!.label}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Basic information about your business"}
              {step === 2 && "Who should we contact about your campaign?"}
              {step === 3 && "Help us build your credibility profile — the more you share, the stronger your AI presence"}
              {step === 4 && "Add your social and review profiles (optional but recommended)"}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">

            {/* ── Step 1: Business Info ── */}
            {step === 1 && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Business Name <span className="text-red-500">*</span></Label>
                  <Input id="name" placeholder="Acme Fence Co." value={form.name} onChange={set("name")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="businessType">Industry / Business Type</Label>
                  <Input id="businessType" placeholder="e.g. Fence Contractor, HVAC, Plumber…" value={form.businessType} onChange={set("businessType")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="website">Website URL</Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <Input id="website" className="pl-9" placeholder="https://yoursite.com" value={form.website} onChange={set("website")} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="location">City / Service Area</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                      <Input id="location" className="pl-9" placeholder="Austin, TX" value={form.location} onChange={set("location")} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Business Phone</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                      <Input id="phone" className="pl-9" placeholder="(512) 555-0100" value={form.phone} onChange={set("phone")} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="address">Full Business Address</Label>
                  <Input id="address" placeholder="123 Main St, Austin, TX 78701" value={form.address} onChange={set("address")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Brief Business Description</Label>
                  <Textarea id="description" rows={3} placeholder="Tell us what makes your business great…" value={form.description} onChange={set("description")} />
                </div>
              </>
            )}

            {/* ── Step 2: Contact ── */}
            {step === 2 && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="contactName">Contact Name <span className="text-red-500">*</span></Label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <Input id="contactName" className="pl-9" placeholder="Jane Smith" value={form.contactName} onChange={set("contactName")} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contactEmail">Contact Email <span className="text-red-500">*</span></Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <Input id="contactEmail" type="email" className="pl-9" placeholder="jane@yourcompany.com" value={form.contactEmail} onChange={set("contactEmail")} />
                  </div>
                </div>
                <p className="text-xs text-gray-400 pt-1">
                  Campaign updates and reports will be sent to this email address.
                </p>
              </>
            )}

            {/* ── Step 3: Credibility ── */}
            {step === 3 && (
              <>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 leading-relaxed">
                  <strong>Why this matters:</strong> The more credibility data you provide, the stronger your AI visibility profile. These details are used to establish your authority in AI-generated answers.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="yearsInBusiness">Years in Business</Label>
                    <Input id="yearsInBusiness" type="number" min={1} placeholder="e.g. 12" value={form.yearsInBusiness} onChange={set("yearsInBusiness")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bbbRating">BBB Rating</Label>
                    <div className="relative">
                      <Star className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                      <Input id="bbbRating" className="pl-9" placeholder="A+" value={form.bbbRating} onChange={set("bbbRating")} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="certifications">Certifications</Label>
                  <Textarea id="certifications" rows={2} placeholder="e.g. Licensed & Insured, EPA Certified, OSHA 30…" value={form.certifications} onChange={set("certifications")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="licenses">Licenses</Label>
                  <Textarea id="licenses" rows={2} placeholder="e.g. TX State Contractor License #12345…" value={form.licenses} onChange={set("licenses")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="awards">Awards & Recognition</Label>
                  <Textarea id="awards" rows={2} placeholder="e.g. Best of Austin 2023, Angie's Super Service Award…" value={form.awards} onChange={set("awards")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="warranties">Warranties / Guarantees</Label>
                  <Textarea id="warranties" rows={2} placeholder="e.g. Lifetime workmanship warranty, 5-year product warranty…" value={form.warranties} onChange={set("warranties")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="differentiators">What Sets You Apart?</Label>
                  <Textarea id="differentiators" rows={3} placeholder="e.g. Family-owned for 20 years, same-day service, free estimates, financing available…" value={form.differentiators} onChange={set("differentiators")} />
                </div>
              </>
            )}

            {/* ── Step 4: Social Profiles ── */}
            {step === 4 && (
              <>
                <p className="text-xs text-gray-500">
                  Paste the full URLs for any profiles you have. Leave blank if not applicable.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { field: "facebookUrl",   label: "Facebook",    placeholder: "https://facebook.com/yourpage" },
                    { field: "instagramUrl",  label: "Instagram",   placeholder: "https://instagram.com/yourhandle" },
                    { field: "linkedinUrl",   label: "LinkedIn",    placeholder: "https://linkedin.com/company/…" },
                    { field: "twitterUrl",    label: "X / Twitter", placeholder: "https://x.com/yourhandle" },
                    { field: "youtubeUrl",    label: "YouTube",     placeholder: "https://youtube.com/@yourchannel" },
                    { field: "tiktokUrl",     label: "TikTok",      placeholder: "https://tiktok.com/@yourhandle" },
                    { field: "yelpUrl",       label: "Yelp",        placeholder: "https://yelp.com/biz/…" },
                    { field: "googleMapsUrl", label: "Google Maps / GBP", placeholder: "https://maps.google.com/…" },
                    { field: "bbbUrl",        label: "BBB Profile", placeholder: "https://bbb.org/us/…" },
                    { field: "angiesUrl",     label: "Angi (Angie's List)", placeholder: "https://angi.com/companylist/…" },
                    { field: "thumbtackUrl",  label: "Thumbtack",   placeholder: "https://thumbtack.com/…" },
                    { field: "houzzUrl",      label: "Houzz",       placeholder: "https://houzz.com/pro/…" },
                  ].map(({ field, label, placeholder }) => (
                    <div key={field} className="space-y-1.5">
                      <Label htmlFor={field}>{label}</Label>
                      <Input
                        id={field}
                        placeholder={placeholder}
                        value={form[field as keyof FormData]}
                        onChange={set(field as keyof FormData)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {error}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => setStep((s) => (s > 1 ? (s - 1) as StepId : s))}
                disabled={step === 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>

              {step < 4 ? (
                <Button
                  onClick={() => setStep((s) => (s < 4 ? (s + 1) as StepId : s))}
                  disabled={!canAdvance()}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {submitMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
                  ) : (
                    <><CheckCircle className="h-4 w-4 mr-2" /> Submit</>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by AI Answer Forge &mdash; your information is secure and will only be used to build your campaign.
        </p>
      </div>
    </div>
  );
}
