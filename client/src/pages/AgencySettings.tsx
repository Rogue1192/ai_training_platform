import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Loader2, Palette, CreditCard, CheckCircle, AlertCircle,
  ArrowLeft, LogOut, Upload, ImageIcon,
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

  useEffect(() => {
    if (agency) {
      setBrandName(agency.brandName ?? "");
      setBrandFromName(agency.brandFromName ?? "");
      setBrandLogoUrl(agency.brandLogoUrl ?? "");
    }
  }, [agency]);

  const [logoUploading, setLogoUploading] = useState(false);
  const uploadLogoMutation = trpc.agency.uploadLogo.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image too large — max 5MB'); return; }
    setLogoUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await uploadLogoMutation.mutateAsync({ dataUrl, fileName: file.name });
      setBrandLogoUrl(result.url);
      toast.success('Logo uploaded! Click “Save Branding” to apply.');
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const handleSaveBranding = () => {
    if (!agency) return;
    updateMutation.mutate({
      id: agency.id,
      brandName: brandName || undefined,
      brandFromName: brandFromName || undefined,
      brandLogoUrl: brandLogoUrl || undefined,
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

  const impersonatedAgencyId = sessionStorage.getItem('impersonatedAgencyId');

  const handleExitImpersonation = () => {
    sessionStorage.removeItem('impersonatedAgencyId');
    navigate('/agencies');
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Impersonation Banner */}
      {impersonatedAgencyId && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-600 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-medium">
            <span>👁</span>
            <span>Viewing as <strong>{agency?.name ?? "Agency"}</strong> — Super Admin impersonation mode</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-400 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 shrink-0"
            onClick={handleExitImpersonation}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Exit Impersonation
          </Button>
        </div>
      )}

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
            <Label>Logo</Label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="pointer-events-none"
                  disabled={logoUploading}
                >
                  {logoUploading
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Uploading…</>
                    : <><Upload className="h-3.5 w-3.5 mr-1.5" />Upload Logo</>}
                </Button>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoFileChange}
                />
              </label>
              <span className="text-xs text-muted-foreground">or paste URL below</span>
            </div>
            <Input
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder="https://youragency.com/logo.png"
            />
            <p className="text-xs text-muted-foreground">
              Displayed on the client intake form and in email headers.
            </p>
          </div>
          {brandLogoUrl && (
            <div className="rounded-md border p-3 bg-muted/30 flex items-center gap-3">
              <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
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
            Manage your payment method and view invoices for client package charges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Payment method status */}
          <div className="flex items-center gap-2 text-sm">
            {agency.hasPaymentMethod ? (
              <>
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-green-700 dark:text-green-400 font-medium">Payment method on file</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-orange-500" />
                <span className="text-orange-700 dark:text-orange-400">No payment method on file</span>
              </>
            )}
          </div>
          {/* Stripe Customer Portal button */}
          <BillingPortalButton />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Billing Portal Button ────────────────────────────────────────────────────
// Opens the Stripe Customer Portal in a new tab so the agency can add/update
// their payment method, download invoices, and manage subscriptions.
function BillingPortalButton() {
  const billingPortalMutation = trpc.agency.billingPortal.useMutation({
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={billingPortalMutation.isPending}
      onClick={() => billingPortalMutation.mutate({ returnUrl: window.location.href })}
    >
      {billingPortalMutation.isPending ? (
        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Opening…</>
      ) : (
        <><CreditCard className="h-4 w-4 mr-2" /> Manage Billing &amp; Payment Method</>
      )}
    </Button>
  );
}
