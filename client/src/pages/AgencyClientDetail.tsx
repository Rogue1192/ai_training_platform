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
  Link2, Copy, Plus, Trash2, ExternalLink, LogOut, Send,
  FileText, ChevronRight, Upload
} from "lucide-react";
import { Input } from "@/components/ui/input";
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

// ─── Content Publish Panel ────────────────────────────────────────────────────
function ContentPublishPanel({ campaignId, campaignStatus }: { campaignId: number; campaignStatus: string }) {
  const utils = trpc.useUtils();
  const [expandedPages, setExpandedPages] = useState<Record<number, boolean>>({});
  const [urlInputs, setUrlInputs] = useState<Record<number, string>>({});

  const { data, isLoading, isError } = trpc.agency.getClientContentPages.useQuery(
    { campaignId },
    { refetchOnWindowFocus: false }
  );

  const setUrl = trpc.agency.setClientContentPageUrl.useMutation({
    onSuccess: (result) => {
      utils.agency.getClientContentPages.invalidate({ campaignId });
      if (result.allUrlsEntered) {
        toast.success("✅ All URLs saved — indexing started automatically.");
      } else {
        toast.success("URL saved.");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading content pages…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-xs text-destructive py-2">Failed to load content pages. Try refreshing.</p>
    );
  }

  const { pages } = data;
  const allUrlsEntered = pages.length > 0 && pages.every((p: any) => !!p.publishedUrl);

  return (
    <div className="space-y-3">
      {/* Status banner */}
      {!allUrlsEntered && pages.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-indigo-500/10 border border-indigo-500/30 px-3 py-2">
          <FileText className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />
          <div className="text-xs text-indigo-300">
            {['training', 'monitoring', 'completed', 'active'].includes(campaignStatus) ? (
              <>
                <p className="font-medium">Action needed — add content to client site</p>
                <p className="text-indigo-300/70 mt-0.5">
                  This client was set up before the self-publishing workflow. Copy each item below into the client's website and paste the live URLs back here to complete the setup.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Content ready — add to your client's site</p>
                <p className="text-indigo-300/70 mt-0.5">
                  Copy each page below into the client's website, then paste the live URL back here. Indexing and training start automatically once all URLs are submitted.
                </p>
              </>
            )}
          </div>
        </div>
      )}
      {allUrlsEntered && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/30 px-3 py-2">
          <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
          <p className="text-xs text-green-300 font-medium">All content URLs recorded — setup complete.</p>
        </div>
      )}

      {/* Page cards */}
      {pages.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">No content pages generated yet.</p>
      )}
      {pages.map((page: any) => {
        const isExpanded = expandedPages[page.id] ?? false;
        // Determine display type for badge and URL placeholder
        const isLlmTxt = page.pageType === "llm_txt";
        const isSchemaPackage = page.pageType === "schema_package";
        const isSchemaDelivery = page.pageType === "schema_delivery";
        const isSpecialType = isLlmTxt || isSchemaPackage || isSchemaDelivery;
        const isNewPage = !isSpecialType && (page.deliveryType === "new_page" || !page.deliveryType);
        // Badge config per type
        const typeBadge = isLlmTxt
          ? { label: "llm.txt — root file", cls: "bg-purple-500/10 text-purple-400 border-purple-500/30" }
          : isSchemaPackage
          ? { label: "Schema markup — inject in <head>", cls: "bg-teal-500/10 text-teal-400 border-teal-500/30" }
          : isSchemaDelivery
          ? { label: "Schema delivery plan", cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" }
          : isNewPage
          ? { label: "New page", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" }
          : { label: "Add to existing", cls: "bg-orange-500/10 text-orange-400 border-orange-500/30" };
        // URL placeholder per type
        const urlPlaceholder = isLlmTxt
          ? "https://clientsite.com/llm.txt"
          : isSchemaPackage || isSchemaDelivery
          ? "https://clientsite.com/ (homepage URL is fine)"
          : "https://client-site.com/page-slug";
        return (
          <div key={page.id} className="rounded-lg border border-border bg-muted/20">
            {/* Header row */}
            <div className="flex items-center gap-3 p-3">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{page.pageTitle}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge variant="outline" className={`text-xs ${typeBadge.cls}`}>
                    {typeBadge.label}
                  </Badge>
                  {!isSpecialType && page.pageSlug && (
                    <span className="text-xs text-muted-foreground">/{page.pageSlug}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {page.publishedUrl ? (
                  <>
                    <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">
                      Published
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => window.open(page.publishedUrl, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                    Needs URL
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setExpandedPages(prev => ({ ...prev, [page.id]: !isExpanded }))}
                >
                  {isExpanded ? "Hide" : "View"}
                </Button>
              </div>
            </div>

            {/* Placement instructions */}
            {page.placementInstructions && (
              <div className="px-3 pb-2 flex items-start gap-2">
                <ChevronRight className="h-3.5 w-3.5 text-indigo-400 mt-0.5 shrink-0" />
                <p className="text-xs text-indigo-300">{page.placementInstructions}</p>
              </div>
            )}

            {/* Expanded content + copy button */}
            {isExpanded && (
              <div className="border-t border-border mx-3 mb-3">
                <div className="flex justify-end pt-2 pb-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => {
                      navigator.clipboard.writeText(page.pageContent);
                      toast.success("Content copied to clipboard!");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    Copy content
                  </Button>
                </div>
                <div className="rounded-md bg-muted/40 p-3 max-h-72 overflow-y-auto">
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono break-words">
                    {page.pageContent}
                  </pre>
                </div>
              </div>
            )}

            {/* URL entry row — only for unpublished pages */}
            {!page.publishedUrl && (
              <div className="flex items-center gap-2 px-3 pb-3">
                <Input
                  placeholder={urlPlaceholder}
                  value={urlInputs[page.id] ?? ""}
                  onChange={(e) => setUrlInputs(prev => ({ ...prev, [page.id]: e.target.value }))}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  disabled={!urlInputs[page.id] || setUrl.isPending}
                  onClick={() => {
                    const url = urlInputs[page.id];
                    if (!url) return;
                    setUrl.mutate({ pageId: page.id, publishedUrl: url });
                  }}
                >
                  {setUrl.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                  Save URL
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Campaign Row ──────────────────────────────────────────────────────────────
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

        {/* Content Publish Panel — shown for any campaign that has passed content generation,
             including pre-existing/active campaigns so agencies can still add credibility
             content, llm.txt, and schema markup to client sites retroactively. */}
        {(['publishing', 'indexing', 'indexing_verification', 'training', 'monitoring', 'completed', 'active'].includes(campaign.status)) && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Content Publishing
            </p>
            <ContentPublishPanel campaignId={campaign.id} campaignStatus={campaign.status} />
          </div>
        )}

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
