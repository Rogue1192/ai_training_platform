import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Loader2, ArrowLeft, Building2, Globe, MapPin, Phone,
  Mail, TrendingUp, CheckCircle, Clock, AlertCircle, Bell,
  Link2, Copy, Plus, Trash2, ExternalLink, LogOut, Send
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function AgencyClientDetail() {
  const params = useParams<{ id: string }>();
  const clientId = parseInt(params.id ?? "0", 10);
  const [, navigate] = useLocation();

  // Fetch the client's business record
  const { data: clients, isLoading: clientsLoading, refetch: refetchClients } = trpc.agency.myClients.useQuery();
  const client = clients?.find((c: any) => c.id === clientId) as any;

  // Fetch campaigns for this business (scoped to agency's clients only)
  const { data: clientCampaigns = [], isLoading: campaignsLoading } = trpc.agency.clientCampaigns.useQuery(
    { businessId: clientId },
    { enabled: !!client && clientId > 0 }
  );

  // Win email toggle mutation
  const setWinEmailsMutation = trpc.agency.setClientWinEmails.useMutation({
    onSuccess: (data) => {
      refetchClients();
      if (data.enabled) {
        toast.success("Win emails enabled — you'll receive a copy of every win email for this client.");
      } else {
        toast.success("Win emails disabled — the client still receives their own emails.");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const isLoading = clientsLoading || campaignsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="font-medium">Client not found</p>
        <Button variant="outline" onClick={() => navigate("/agency")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Portal
        </Button>
      </div>
    );
  }

  // Default to true if field is null/undefined (existing clients before migration)
  const winEmailsEnabled = client.agencyWinEmailsEnabled !== false;

  const impersonatedAgencyId = sessionStorage.getItem('impersonatedAgencyId');

  const handleExitImpersonation = () => {
    sessionStorage.removeItem('impersonatedAgencyId');
    navigate('/admin/agencies');
  };

  return (
    <div className="space-y-6">
      {/* Impersonation Banner */}
      {impersonatedAgencyId && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-600 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-medium">
            <span>👁</span>
            <span>Viewing as <strong>{client?.agencyName ?? "Agency"}</strong> — Super Admin impersonation mode</span>
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
          <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {client.businessType || "Client"} · {client.location || "No location set"}
          </p>
        </div>
      </div>

      {/* Client Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Business Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {client.website && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <a
                  href={client.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  {client.website.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}
            {client.location && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>{client.location}</span>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span>{client.phone}</span>
              </div>
            )}
            {client.contactEmail && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span>{client.contactEmail}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Campaign Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Campaigns</span>
              <span className="font-medium">{clientCampaigns.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active</span>
              <span className="font-medium text-green-500">
                {clientCampaigns.filter((c: any) => c.isActive).length}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Trial Status</span>
              <span className="font-medium capitalize">
                {client.trialStatus ?? "Active"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notification Preferences */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Notification Preferences
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={`win-emails-${clientId}`} className="text-sm font-medium">
                Win email notifications
              </Label>
              <p className="text-xs text-muted-foreground">
                {winEmailsEnabled
                  ? "You receive a copy of every win email sent to this client."
                  : "Win emails go to the client only — you won't be CC'd."}
              </p>
            </div>
            <Switch
              id={`win-emails-${clientId}`}
              checked={winEmailsEnabled}
              disabled={setWinEmailsMutation.isPending}
              onCheckedChange={(checked) =>
                setWinEmailsMutation.mutate({ businessId: clientId, enabled: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Campaigns */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Campaigns ({clientCampaigns.length})
        </h2>
        {!clientCampaigns.length ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No campaigns yet for this client.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {clientCampaigns.map((campaign: any) => (
              <CampaignRow
                key={campaign.id}
                campaign={campaign}
                businessId={clientId}
                clientEmail={client.contactEmail ?? undefined}
                clientName={client.contactName ?? undefined}
                businessName={client.name}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ campaign, businessId, clientEmail, clientName, businessName }: {
  campaign: any;
  businessId: number;
  clientEmail?: string;
  clientName?: string;
  businessName?: string;
}) {
  const isActive = campaign.isActive;
  const trialStatus = campaign.trialStatus;
  const [showLinks, setShowLinks] = useState(false);
  const [sendEmailLinkId, setSendEmailLinkId] = useState<number | null>(null);
  const [emailInput, setEmailInput] = useState(clientEmail ?? '');

  const { data: reportLinks = [], refetch: refetchLinks } = trpc.agency.getClientReportLinks.useQuery(
    { campaignId: campaign.id },
    { enabled: showLinks }
  );

  const createLink = trpc.agency.createClientReportLink.useMutation({
    onSuccess: () => {
      refetchLinks();
      toast.success("Report link created");
    },
    onError: (err) => toast.error(err.message),
  });

  const deactivateLink = trpc.agency.deactivateClientReportLink.useMutation({
    onSuccess: () => {
      refetchLinks();
      toast.success("Link deactivated");
    },
    onError: (err) => toast.error(err.message),
  });

  const sendEmail = trpc.agency.sendReportEmail.useMutation({
    onSuccess: () => {
      toast.success("Report email sent!");
      setSendEmailLinkId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const baseUrl = window.location.origin;

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${baseUrl}/report/${token}`);
    toast.success("Link copied to clipboard");
  }

  return (
    <Card>
      <CardContent className="py-3 px-4 space-y-3">
        {/* Campaign header row */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{campaign.name || `Campaign #${campaign.id}`}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {campaign.maxQueries ?? 5} keywords · {campaign.maxLocations ?? 3} locations
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {trialStatus === "trial" && (
              <Badge variant="secondary" className="text-xs">
                <Clock className="h-3 w-3 mr-1" /> Trial
              </Badge>
            )}
            <Badge variant={isActive ? "default" : "outline"} className="text-xs">
              {isActive
                ? <><CheckCircle className="h-3 w-3 mr-1" />Active</>
                : <><AlertCircle className="h-3 w-3 mr-1" />Inactive</>
              }
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => setShowLinks((v) => !v)}
            >
              <Link2 className="h-3 w-3 mr-1" />
              {showLinks ? "Hide" : "Report Links"}
            </Button>
          </div>
        </div>

        {/* Report links panel */}
        {showLinks && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Client Report Links</p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={createLink.isPending}
                onClick={() => createLink.mutate({ campaignId: campaign.id, businessId })}
              >
                {createLink.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
                New Link
              </Button>
            </div>

            {reportLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No report links yet. Click "New Link" to generate one to share with your client.
              </p>
            ) : (
              <div className="space-y-2">
                {reportLinks.map((link: any) => (
                  <div
                    key={link.id}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                      link.isActive ? "border-border bg-muted/30" : "border-dashed opacity-50"
                    }`}
                  >
                    <span className="font-mono text-muted-foreground truncate flex-1">
                      {baseUrl}/report/{link.accessToken.substring(0, 16)}…
                    </span>
                    {link.isActive && (
                      <>
                        <span className="text-muted-foreground shrink-0">
                          {link.accessCount ?? 0} views
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => copyLink(link.accessToken)}
                          title="Copy link"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 text-blue-500 hover:text-blue-600"
                          onClick={() => {
                            setSendEmailLinkId(sendEmailLinkId === link.id ? null : link.id);
                            setEmailInput(clientEmail ?? '');
                          }}
                          title="Send report via email"
                        >
                          <Send className="h-3 w-3" />
                        </Button>
                        <a
                          href={`${baseUrl}/report/${link.accessToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" title="Open report">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </a>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => deactivateLink.mutate({ dashboardId: link.id })}
                          title="Deactivate link"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                    {/* Inline send email form */}
                    {link.isActive && sendEmailLinkId === link.id && (
                      <div className="w-full mt-2 flex items-center gap-2">
                        <input
                          type="email"
                          className="flex-1 h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          placeholder="client@email.com"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                        />
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={sendEmail.isPending || !emailInput}
                          onClick={() => sendEmail.mutate({
                            dashboardId: link.id,
                            toEmail: emailInput,
                            clientName: clientName,
                            businessName: businessName,
                          })}
                        >
                          {sendEmail.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                          Send
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setSendEmailLinkId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                    {!link.isActive && (
                      <Badge variant="outline" className="text-[10px] shrink-0">Inactive</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
