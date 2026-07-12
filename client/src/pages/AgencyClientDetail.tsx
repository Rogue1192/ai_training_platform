import { useState, useEffect } from "react";
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
    navigate('/agencies');
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
  const [expandedPages, setExpandedPages] = useState<Record<number | string, boolean | string>>({});
  const [urlInputs, setUrlInputs] = useState<Record<number, string>>({});

  // Verification state — seeded from DB on load, updated after each scan
  const [llmVerified, setLlmVerified] = useState(false);
  const [schemaVerified, setSchemaVerified] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [scanningLlm, setScanningLlm] = useState(false);
  const [scanningSchema, setScanningSchema] = useState(false);
  const [verificationSeeded, setVerificationSeeded] = useState(false);

  const verifyLlmMutation = trpc.verifyCampaignContent.useMutation({
    onSuccess: (result) => {
      setLlmVerified(result.llmTxt.detected);
      setLlmError(result.llmTxt.detected ? null : (result.llmTxt.error ?? 'Not detected'));
      setScanningLlm(false);
      utils.agency.myClients.invalidate();
      if (result.llmTxt.detected) {
        toast.success('✅ llm.txt detected — verified!');
      } else {
        toast.error('llm.txt not found — fix the issue on the client site and try again.');
      }
    },
    onError: (err) => {
      setScanningLlm(false);
      toast.error(`Scan failed: ${err.message}`);
    },
  });

  const verifySchemaMutation = trpc.verifyCampaignContent.useMutation({
    onSuccess: (result) => {
      setSchemaVerified(result.schema.detected);
      setSchemaError(result.schema.detected ? null : (result.schema.error ?? 'Not detected'));
      setScanningSchema(false);
      utils.agency.myClients.invalidate();
      if (result.schema.detected) {
        toast.success('✅ JSON-LD schema detected — verified!');
      } else {
        toast.error('Schema not found — fix the issue on the client site and try again.');
      }
    },
    onError: (err) => {
      setScanningSchema(false);
      toast.error(`Scan failed: ${err.message}`);
    },
  });

  const handleLlmCheck = () => {
    if (scanningLlm || llmVerified) return;
    setScanningLlm(true);
    setLlmError(null);
    verifyLlmMutation.mutate({ campaignId, scanType: 'llm' });
  };

  const handleSchemaCheck = () => {
    if (scanningSchema || schemaVerified) return;
    setScanningSchema(true);
    setSchemaError(null);
    verifySchemaMutation.mutate({ campaignId, scanType: 'schema' });
  };

  const { data, isLoading, isError } = trpc.agency.getClientContentPages.useQuery(
    { campaignId },
    { refetchOnWindowFocus: false }
  );

  // Seed verification state from DB on first load
  useEffect(() => {
    if (data && !verificationSeeded) {
      setLlmVerified((data as any).llmTxtVerified ?? false);
      setSchemaVerified((data as any).schemaVerified ?? false);
      setVerificationSeeded(true);
    }
  }, [data, verificationSeeded]);

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
  // Pages that require a URL (exclude schema/llm_txt types — those are verified by scan)
  const NO_URL_REQUIRED_TYPES = new Set(['llm_txt', 'schema_package', 'schema_audit', 'schema_delivery']);
  const urlPages = pages.filter((p: any) => !NO_URL_REQUIRED_TYPES.has(p.pageType));
  const allUrlsEntered = urlPages.length > 0 && urlPages.every((p: any) => !!p.publishedUrl);
  const allVerified = allUrlsEntered && llmVerified && schemaVerified;
  const hasAnyIssue = !allUrlsEntered || !llmVerified || !schemaVerified;
  const scanning = scanningLlm || scanningSchema; // legacy alias for banner

  return (
    <div className="space-y-3">
      {/* RED WARNING BANNER — shown whenever anything is incomplete */}
      {hasAnyIssue && pages.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-red-500/15 border border-red-500/50 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <div className="text-xs text-red-300 space-y-1">
            <p className="font-semibold text-red-200">⛔ Campaign blocked — content not yet live on client site</p>
            <p className="text-red-300/80">
              The campaign cannot advance to indexing or training until ALL items below are confirmed live.
              Enter the URL for each content page, then check the boxes to verify llm.txt and schema are installed.
            </p>
            <ul className="mt-1 space-y-0.5 text-red-300/70">
              {!allUrlsEntered && (
                <li>• {urlPages.filter((p: any) => !p.publishedUrl).length} content page(s) still need a live URL</li>
              )}
              {!llmVerified && <li>• llm.txt not yet verified on client site</li>}
              {!schemaVerified && <li>• JSON-LD schema not yet verified on client site</li>}
            </ul>
          </div>
        </div>
      )}

      {/* ALL CLEAR banner */}
      {allVerified && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/30 px-3 py-2">
          <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
          <p className="text-xs text-green-300 font-medium">✅ All content verified live — campaign can advance.</p>
        </div>
      )}

      {/* LLM.TXT + SCHEMA VERIFICATION CHECKBOXES — two independent scans */}
      {pages.some((p: any) => p.pageType === 'llm_txt' || p.pageType === 'schema_package' || p.pageType === 'schema_delivery') && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Site Verification</p>
          <p className="text-xs text-muted-foreground mb-2">Check each box once you've added the asset to the client's site. Each checkbox scans independently — both must pass before the campaign unblocks.</p>

          {/* Checkbox 1: llm.txt */}
          <div
            className={`flex items-start gap-3 p-2 rounded-md border cursor-pointer select-none transition-colors ${
              llmVerified
                ? 'border-green-500/40 bg-green-500/5'
                : scanningLlm
                ? 'border-amber-500/40 bg-amber-500/5'
                : llmError
                ? 'border-red-500/40 bg-red-500/5'
                : 'border-border hover:border-muted-foreground/40'
            }`}
            onClick={handleLlmCheck}
          >
            <div className={`mt-0.5 h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
              llmVerified ? 'border-green-500 bg-green-500' : scanningLlm ? 'border-amber-400' : llmError ? 'border-red-500' : 'border-muted-foreground'
            }`}>
              {scanningLlm && <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-400" />}
              {!scanningLlm && llmVerified && <CheckCircle className="h-2.5 w-2.5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">
                {scanningLlm ? 'Scanning for llm.txt…' : llmVerified ? "I've added llm.txt to the site ✓" : "I've added llm.txt to the client's site"}
              </p>
              {!scanningLlm && !llmVerified && !llmError && (
                <p className="text-xs text-muted-foreground mt-0.5">Click to scan {'{domain}'}/llm.txt now</p>
              )}
              {!scanningLlm && llmError && (
                <div className="text-xs mt-0.5 flex items-center gap-1 text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  Not detected — {llmError}
                </div>
              )}
              {!scanningLlm && llmError && (
                <p className="text-xs text-amber-400/80 mt-1">Fix the issue, then click again to re-scan.</p>
              )}
            </div>
          </div>

          {/* Checkbox 2: JSON-LD schema */}
          <div
            className={`flex items-start gap-3 p-2 rounded-md border cursor-pointer select-none transition-colors ${
              schemaVerified
                ? 'border-green-500/40 bg-green-500/5'
                : scanningSchema
                ? 'border-amber-500/40 bg-amber-500/5'
                : schemaError
                ? 'border-red-500/40 bg-red-500/5'
                : 'border-border hover:border-muted-foreground/40'
            }`}
            onClick={handleSchemaCheck}
          >
            <div className={`mt-0.5 h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
              schemaVerified ? 'border-green-500 bg-green-500' : scanningSchema ? 'border-amber-400' : schemaError ? 'border-red-500' : 'border-muted-foreground'
            }`}>
              {scanningSchema && <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-400" />}
              {!scanningSchema && schemaVerified && <CheckCircle className="h-2.5 w-2.5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">
                {scanningSchema ? 'Scanning homepage for JSON-LD schema…' : schemaVerified ? "I've injected the JSON-LD schema ✓" : "I've injected the JSON-LD schema on the client's site"}
              </p>
              {!scanningSchema && !schemaVerified && !schemaError && (
                <p className="text-xs text-muted-foreground mt-0.5">Click to scan the homepage for a JSON-LD &#x3C;script&#x3E; block</p>
              )}
              {!scanningSchema && schemaError && (
                <div className="text-xs mt-0.5 flex items-center gap-1 text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  Not detected — {schemaError}
                </div>
              )}
              {!scanningSchema && schemaError && (
                <p className="text-xs text-amber-400/80 mt-1">Fix the issue, then click again to re-scan.</p>
              )}
            </div>
          </div>
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
                  {isExpanded ? "Hide Content" : "Copy Content to Paste"}
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
            {isExpanded && (() => {
              const plainText = page.pageContent
                ? page.pageContent.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim()
                : '';
              const contentTab = expandedPages[`${page.id}_tab`] ?? 'html';
              return (
                <div className="border-t border-border mx-3 mb-3">
                  <div className="flex items-center justify-between pt-2 pb-1">
                    <div className="flex gap-1">
                      <Button
                        variant={contentTab === 'html' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setExpandedPages(prev => ({ ...prev, [`${page.id}_tab`]: 'html' }))}
                      >HTML</Button>
                      <Button
                        variant={contentTab === 'plain' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setExpandedPages(prev => ({ ...prev, [`${page.id}_tab`]: 'plain' }))}
                      >Plain Text</Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => {
                        const toCopy = contentTab === 'plain' ? plainText : page.pageContent;
                        navigator.clipboard.writeText(toCopy);
                        toast.success(contentTab === 'plain' ? 'Plain text copied!' : 'HTML copied!');
                      }}
                    >
                      <Copy className="h-3 w-3" />
                      Copy {contentTab === 'plain' ? 'Plain Text' : 'HTML'}
                    </Button>
                  </div>
                  <div className="rounded-md bg-muted/40 p-3 max-h-72 overflow-y-auto">
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono break-words">
                      {contentTab === 'plain' ? plainText : page.pageContent}
                    </pre>
                  </div>
                </div>
              );
            })()}

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

// ─── Client Report Viewer ────────────────────────────────────────────────────
// Fetches the first active report link for a campaign and renders it in an iframe
// so the agency/super-admin can see exactly what the client sees.
function ClientReportViewer({ campaignId, baseUrl }: { campaignId: number; baseUrl: string }) {
  const { data: links = [], isLoading } = trpc.agency.getClientReportLinks.useQuery({ campaignId });

  const createLink = trpc.agency.createClientReportLink.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const activeLink = links.find((l: any) => l.isActive);

  if (isLoading) {
    return (
      <div className="border-t pt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading report…
      </div>
    );
  }

  if (!activeLink) {
    return (
      <div className="border-t pt-3 space-y-2">
        <p className="text-xs text-muted-foreground">No active report link yet.</p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={createLink.isPending}
          onClick={() => createLink.mutate({ campaignId, businessId: 0 })}
        >
          {createLink.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
          Generate Report Link
        </Button>
      </div>
    );
  }

  const reportUrl = `${baseUrl}/report/${activeLink.accessToken}`;

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Client Visibility Report</p>
        <a href={reportUrl} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="ghost" className="h-6 text-xs">
            <ExternalLink className="h-3 w-3 mr-1" /> Open in new tab
          </Button>
        </a>
      </div>
      <div className="rounded-lg border overflow-hidden" style={{ height: '600px' }}>
        <iframe
          src={reportUrl}
          title="Client Report"
          className="w-full h-full"
          style={{ border: 'none' }}
        />
      </div>
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
  const [showReport, setShowReport] = useState(false);
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
              {showLinks ? "Hide Links" : "Report Links"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2 text-blue-600 hover:text-blue-700"
              onClick={() => setShowReport((v) => !v)}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {showReport ? "Hide Report" : "View Report"}
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

        {/* Inline client report viewer — loads the first active report link in an iframe */}
        {showReport && (
          <ClientReportViewer campaignId={campaign.id} baseUrl={baseUrl} />
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
