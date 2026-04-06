import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Palette, CreditCard, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";
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

      {/* White-Label Branding */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">White-Label Branding</CardTitle>
          </div>
          <CardDescription>
            Customize how your agency appears in client-facing emails and reports.
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
            <p className="text-xs text-muted-foreground">Shown in email headers and client reports.</p>
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
            <p className="text-xs text-muted-foreground">Displayed in email headers. Use a direct image URL (PNG or SVG recommended).</p>
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
