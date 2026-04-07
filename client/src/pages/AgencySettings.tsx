import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Loader2, Palette, CreditCard, CheckCircle, AlertCircle,
  ArrowLeft, Key, Eye, EyeOff, Trash2,
} from "lucide-react";
import { useLocation } from "wouter";

export default function AgencySettings() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: agency, isLoading } = trpc.agency.myAgency.useQuery();

  const updateMutation = trpc.agency.update.useMutation({
    onSuccess: () => {
      toast.success("Settings saved");
      utils.agency.myAgency.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Branding
  const [brandName, setBrandName] = useState("");
  const [brandFromName, setBrandFromName] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");

  // API Keys
  const [openAiKey, setOpenAiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  useEffect(() => {
    if (agency) {
      setBrandName(agency.brandName ?? "");
      setBrandFromName(agency.brandFromName ?? "");
      setBrandLogoUrl(agency.brandLogoUrl ?? "");
      // Keys are stored encrypted — never returned to frontend. Fields stay blank unless user types a new one.
    }
  }, [agency]);

  const handleSaveBranding = () => {
    if (!agency) return;
    updateMutation.mutate({
      id: agency.id,
      brandName: brandName || undefined,
      brandFromName: brandFromName || undefined,
      brandLogoUrl: brandLogoUrl || undefined,
    });
  };

  const handleSaveApiKeys = () => {
    if (!agency) return;
    if (!openAiKey && !geminiKey) {
      toast.error("Enter at least one API key to save.");
      return;
    }
    updateMutation.mutate({
      id: agency.id,
      agencyOpenAiKey: openAiKey || undefined,
      agencyGeminiKey: geminiKey || undefined,
    });
    // Clear fields after save so they don't persist in plaintext
    setOpenAiKey("");
    setGeminiKey("");
  };

  const handleRemoveKey = (provider: "openai" | "gemini") => {
    if (!agency) return;
    updateMutation.mutate({
      id: agency.id,
      agencyOpenAiKey: provider === "openai" ? null : undefined,
      agencyGeminiKey: provider === "gemini" ? null : undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="font-medium">No agency account found</p>
        <p className="text-sm text-muted-foreground">Contact your administrator.</p>
      </div>
    );
  }

  const hasOpenAiKey = !!(agency as any).agencyOpenAiKey;
  const hasGeminiKey = !!(agency as any).agencyGeminiKey;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/agency")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agency Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">{agency.name}</p>
        </div>
      </div>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Information</CardTitle>
          <CardDescription>Your agency account details managed by your administrator.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Agency Name</p>
              <p className="font-medium">{agency.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Package Tier</p>
              <p className="font-medium capitalize">{agency.packageTier}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Contact Email</p>
              <p className="font-medium">{agency.contactEmail}</p>
            </div>
            {agency.contactName && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Contact Name</p>
                <p className="font-medium">{agency.contactName}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Training API Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">AI Training API Keys</CardTitle>
          </div>
          <CardDescription>
            Your OpenAI and Google Gemini keys are used for live AI training queries on behalf of your clients.
            These costs are billed directly to your API accounts — not to your platform subscription.
            Keys are stored encrypted and never displayed after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* OpenAI Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>OpenAI API Key</Label>
              {hasOpenAiKey && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Key on file
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleRemoveKey("openai")}
                    disabled={updateMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Remove
                  </Button>
                </div>
              )}
            </div>
            <div className="relative">
              <Input
                type={showOpenAiKey ? "text" : "password"}
                value={openAiKey}
                onChange={(e) => setOpenAiKey(e.target.value)}
                placeholder={hasOpenAiKey ? "Enter new key to replace existing" : "sk-..."}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowOpenAiKey((v) => !v)}
              >
                {showOpenAiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Used for ChatGPT training queries. Get your key at{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="underline">
                platform.openai.com/api-keys
              </a>
            </p>
          </div>

          {/* Gemini Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Google Gemini API Key</Label>
              {hasGeminiKey && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Key on file
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleRemoveKey("gemini")}
                    disabled={updateMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Remove
                  </Button>
                </div>
              )}
            </div>
            <div className="relative">
              <Input
                type={showGeminiKey ? "text" : "password"}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={hasGeminiKey ? "Enter new key to replace existing" : "AIza..."}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowGeminiKey((v) => !v)}
              >
                {showGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Used for Google AI Mode / Gemini training queries. Get your key at{" "}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline">
                aistudio.google.com
              </a>
            </p>
          </div>

          {/* Warning banner if keys are missing */}
          {(!hasOpenAiKey || !hasGeminiKey) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">API keys required for training</p>
                  <p className="text-xs mt-0.5">
                    Training sessions will fail and you will be notified if a required key is missing or invalid.
                    Add both keys to ensure uninterrupted service for your clients.
                  </p>
                </div>
              </div>
            </div>
          )}

          <Button onClick={handleSaveApiKeys} disabled={updateMutation.isPending || (!openAiKey && !geminiKey)}>
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save API Keys
          </Button>
        </CardContent>
      </Card>

      {/* White-Label Branding */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">White-Label Branding</CardTitle>
          </div>
          <CardDescription>
            Customize how your agency appears in client-facing emails and the intake form.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Brand Name</Label>
            <Input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Your Agency Name"
            />
            <p className="text-xs text-muted-foreground">Shown in email headers and on your client intake form.</p>
          </div>
          <div className="space-y-1.5">
            <Label>From Name (emails)</Label>
            <Input
              value={brandFromName}
              onChange={(e) => setBrandFromName(e.target.value)}
              placeholder="Your Agency Team"
            />
            <p className="text-xs text-muted-foreground">The sender name clients see in their inbox.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder="https://youragency.com/logo.png"
            />
            <p className="text-xs text-muted-foreground">
              Displayed on the client intake form and in email headers. Use a direct image URL (PNG or SVG recommended).
            </p>
          </div>
          {brandLogoUrl && (
            <div className="rounded-md border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground mb-2">Logo preview:</p>
              <img
                src={brandLogoUrl}
                alt="Brand logo preview"
                className="max-h-12 max-w-[200px] object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
          <Button onClick={handleSaveBranding} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Branding
          </Button>
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Billing</CardTitle>
          </div>
          <CardDescription>
            Payment method on file for client package charges.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {agency.hasPaymentMethod ? (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Payment method on file</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span>No payment method on file. Contact your administrator to add billing.</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
