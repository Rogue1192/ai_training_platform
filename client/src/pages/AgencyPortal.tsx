import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import AddClientModal from "@/components/AddClientModal";
import {
  Loader2, Building2, MapPin, Globe, ArrowRight,
  TrendingUp, AlertCircle, CheckCircle, Clock, Settings, Plus,
  Users, Link, Copy, Check, Package, LogOut, ExternalLink, BarChart3, FileText,
} from "lucide-react";

const STATUS_CONFIG: Record<string, {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: React.ElementType;
}> = {
  trial:   { label: "Trial",   variant: "secondary",    icon: Clock },
  active:  { label: "Active",  variant: "default",      icon: CheckCircle },
  paused:  { label: "Paused",  variant: "outline",      icon: AlertCircle },
  expired: { label: "Expired", variant: "destructive",  icon: AlertCircle },
};

const TIER_LABELS: Record<string, string> = {
  starter: "Starter",
  growth:  "Growth",
  pro:     "Pro",
};

export default function AgencyPortal() {
  const [, navigate] = useLocation();
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data: agency, isLoading: agencyLoading } = trpc.agency.myAgency.useQuery();
  const { data: clients, isLoading: clientsLoading, refetch: refetchClients } = trpc.agency.myClients.useQuery();
  const { data: intakeData } = trpc.agency.getIntakeToken.useQuery(undefined, {
    enabled: !!agency,
  });

  const assignTierMutation = trpc.agency.assignClientTier.useMutation({
    onSuccess: () => {
      refetchClients();
      toast.success("Package assigned — campaign will start shortly.");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const isLoading = agencyLoading || clientsLoading;

  const handleCopyLink = () => {
    if (!intakeData?.intakeUrl) return;
    const fullUrl = `${window.location.origin}${intakeData.intakeUrl}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success("Link copied! Send this to your client to fill out their onboarding form.");
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
        <p className="text-sm text-muted-foreground">
          Contact your administrator to set up your agency account.
        </p>
      </div>
    );
  }

  // Split clients: pending (need tier assigned) vs active
  const pendingClients = clients?.filter((c: any) =>
    !c.agencyPackageTier && !c.hasCampaign && c.billingType !== 'legacy'
  ) ?? [];
  const activeClients = clients?.filter((c: any) =>
    c.agencyPackageTier || c.hasCampaign || c.billingType === 'legacy'
  ) ?? [];

  const trialClients = clients?.filter((c: any) => c.trialStatus === "trial") ?? [];

  const tierCounts = (activeClients).reduce((acc: Record<string, number>, c: any) => {
    const tier = c.agencyPackageTier ?? "unknown";
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});

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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {agency.brandName || agency.name}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Agency Portal — {clients?.length ?? 0} client{clients?.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Copy intake link */}
          {intakeData?.intakeUrl && (
            <Button variant="outline" size="sm" onClick={handleCopyLink}>
              {copied ? (
                <><Check className="h-4 w-4 mr-2 text-green-500" /> Copied!</>
              ) : (
                <><Copy className="h-4 w-4 mr-2" /> Copy Client Link</>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate("/agency/settings")}>
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button size="sm" onClick={() => setAddClientOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Client
          </Button>
        </div>
      </div>

      {/* Intake link info banner */}
      {intakeData?.intakeUrl && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Link className="h-4 w-4 text-blue-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Your Client Onboarding Link</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 truncate">
                    {window.location.origin}{intakeData.intakeUrl}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={handleCopyLink}>
                {copied ? <><Check className="h-3.5 w-3.5 mr-1.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Link</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Total Clients"   value={clients?.length ?? 0}   icon={Users}        />
        <StatCard label="Active"          value={activeClients.length}    icon={CheckCircle}  color="text-green-500" />
        <StatCard label="Awaiting Setup"  value={pendingClients.length}   icon={AlertCircle}  color={pendingClients.length > 0 ? "text-orange-500" : "text-foreground"} />
      </div>

      {/* ── Pending clients — need tier assigned ── */}
      {pendingClients.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-orange-600">
              Action Required — Assign Package
            </h2>
            <Badge variant="destructive" className="text-xs">{pendingClients.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            These clients submitted their onboarding form. Select a package to start their campaign.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingClients.map((client: any) => (
              <PendingClientCard
                key={client.id}
                client={client}
                agencyId={agency.id}
                onAssign={(tier) =>
                  assignTierMutation.mutate({ agencyId: agency.id, businessId: client.id, packageTier: tier as any })
                }
                isAssigning={assignTierMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tier breakdown */}
      {Object.keys(tierCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(tierCounts).map(([tier, count]) => (
            <Badge key={tier} variant="outline" className="text-xs capitalize">
              {TIER_LABELS[tier] ?? tier}: {count} client{count !== 1 ? "s" : ""}
            </Badge>
          ))}
        </div>
      )}

      {/* ── Tabs: My Clients | Client Reports ── */}
      <Tabs defaultValue="clients">
        <TabsList className="mb-4">
          <TabsTrigger value="clients" className="gap-2">
            <Users className="h-4 w-4" />
            My Clients
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="h-4 w-4" />
            Client Reports
          </TabsTrigger>
        </TabsList>

        {/* ── My Clients tab ── */}
        <TabsContent value="clients">
          {!clients?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Building2 className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-medium">No clients yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Add your first client manually or copy your onboarding link and send it to your client — they fill it out, you assign the package, and the campaign starts automatically.
                </p>
                <div className="flex gap-2 mt-4 flex-wrap justify-center">
                  {intakeData?.intakeUrl && (
                    <Button variant="outline" onClick={handleCopyLink}>
                      <Copy className="h-4 w-4 mr-2" /> Copy Client Link
                    </Button>
                  )}
                  <Button onClick={() => setAddClientOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Add Client Manually
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : activeClients.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeClients.map((client: any) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  onClick={() => navigate(`/agency/clients/${client.id}`)}
                />
              ))}
            </div>
          ) : null}
        </TabsContent>

        {/* ── Client Reports tab ── */}
        <TabsContent value="reports">
          <ClientReportsTab agencyId={agency.id} />
        </TabsContent>
      </Tabs>

      {/* Add Client Modal */}
      <AddClientModal
        open={addClientOpen}
        onClose={() => setAddClientOpen(false)}
        agencyId={agency.id}
        onSuccess={(businessId) => {
          navigate(`/agency/clients/${businessId}`);
        }}
      />
    </div>
  );
}

// ─── Client Reports Tab ───────────────────────────────────────────────────────

function ClientReportsTab({ agencyId }: { agencyId: number }) {
  const { data: dashboards, isLoading } = trpc.agency.myClientDashboards.useQuery();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  function getReportUrl(token: string) {
    return `${window.location.origin}/report/${token}`;
  }

  function copyReportUrl(id: number, token: string) {
    navigator.clipboard.writeText(getReportUrl(token)).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
      toast.success("Report link copied — send this to your client.");
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dashboards?.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">No client reports yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Report links are created automatically when a campaign is set up. Once your clients have active campaigns, their report links will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {dashboards.map((d: any) => (
        <ReportCard
          key={d.id}
          dashboard={d}
          isCopied={copiedId === d.id}
          onCopy={() => copyReportUrl(d.id, d.accessToken)}
          onOpen={() => window.open(getReportUrl(d.accessToken), "_blank")}
        />
      ))}
    </div>
  );
}

function ReportCard({
  dashboard, isCopied, onCopy, onOpen,
}: {
  dashboard: any;
  isCopied: boolean;
  onCopy: () => void;
  onOpen: () => void;
}) {
  return (
    <Card className={`transition-colors ${dashboard.isActive ? "hover:border-primary/40" : "opacity-60"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">
            {dashboard.businessName ?? "Unknown Client"}
          </CardTitle>
          <Badge
            variant={dashboard.isActive ? "default" : "secondary"}
            className={`shrink-0 text-xs ${dashboard.isActive ? "bg-green-500/20 text-green-400 border-green-500/30" : ""}`}
          >
            {dashboard.isActive ? "Active" : "Disabled"}
          </Badge>
        </div>
        {dashboard.dashboardTitle && (
          <CardDescription className="text-xs">{dashboard.dashboardTitle}</CardDescription>
        )}
        {dashboard.businessWebsite && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{dashboard.businessWebsite.replace(/^https?:\/\//, "")}</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="pb-3 space-y-2">
        {/* View count */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BarChart3 className="h-3 w-3 shrink-0" />
          <span>{dashboard.accessCount ?? 0} view{(dashboard.accessCount ?? 0) !== 1 ? "s" : ""}</span>
          {dashboard.lastAccessedAt && (
            <span className="ml-1">· Last viewed {new Date(dashboard.lastAccessedAt).toLocaleDateString()}</span>
          )}
        </div>
        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs gap-1.5"
            onClick={onCopy}
          >
            {isCopied ? (
              <><Check className="h-3 w-3 text-green-500" /> Copied!</>
            ) : (
              <><Copy className="h-3 w-3" /> Copy Link</>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            onClick={onOpen}
            title="Preview report"
          >
            <ExternalLink className="h-3 w-3" />
            Preview
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, color = "text-foreground",
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-bold mt-0.5 ${color}`}>{value}</p>
          </div>
          <Icon className={`h-5 w-5 ${color} opacity-70`} />
        </div>
      </CardContent>
    </Card>
  );
}

function PendingClientCard({
  client, agencyId, onAssign, isAssigning,
}: {
  client: any;
  agencyId: number;
  onAssign: (tier: string) => void;
  isAssigning: boolean;
}) {
  const [selectedTier, setSelectedTier] = useState<string>("");

  return (
    <Card className="border-orange-200 bg-orange-50/50 dark:bg-orange-950/10 dark:border-orange-800">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">{client.name}</CardTitle>
          <Badge variant="outline" className="text-xs border-orange-300 text-orange-700 shrink-0">
            Pending
          </Badge>
        </div>
        {client.businessType && (
          <CardDescription className="text-xs">{client.businessType}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="pb-3 space-y-3">
        {client.location && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{client.location}</span>
          </div>
        )}
        {client.contactEmail && (
          <div className="text-xs text-muted-foreground truncate">{client.contactEmail}</div>
        )}
        {/* Tier selector + assign button */}
        <div className="flex gap-2 pt-1">
          <Select value={selectedTier} onValueChange={setSelectedTier}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="Select package…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="growth">Growth</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 text-xs px-3"
            disabled={!selectedTier || isAssigning}
            onClick={() => onAssign(selectedTier)}
          >
            {isAssigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Package className="h-3 w-3 mr-1" /> Assign</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ClientCard({ client, onClick }: { client: any; onClick: () => void }) {
  const isBlocked = client.campaignBlocked === true;
  const status = client.trialStatus ?? "active";
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active!;
  const StatusIcon = cfg.icon;

  return (
    <Card
      className={`cursor-pointer transition-colors ${
        isBlocked
          ? "border-red-500 hover:border-red-400"
          : "hover:border-primary/50"
      }`}
      onClick={onClick}
    >
      {isBlocked && (
        <div className="flex items-center gap-2 bg-red-950/60 border-b border-red-500/50 px-3 py-2 rounded-t-lg">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          <span className="text-xs font-semibold text-red-300">Action Required — content not live on client site</span>
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">{client.name}</CardTitle>
          {isBlocked ? (
            <Badge variant="destructive" className="shrink-0 text-xs">
              <AlertCircle className="h-3 w-3 mr-1" />
              Blocked
            </Badge>
          ) : (
            <Badge variant={cfg.variant} className="shrink-0 text-xs">
              <StatusIcon className="h-3 w-3 mr-1" />
              {cfg.label}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {client.businessType && (
            <CardDescription className="text-xs">{client.businessType}</CardDescription>
          )}
          {client.agencyPackageTier && (
            <Badge variant="outline" className="text-xs capitalize">
              {TIER_LABELS[client.agencyPackageTier] ?? client.agencyPackageTier}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-3 space-y-1.5">
        {client.location && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{client.location}</span>
          </div>
        )}
        {client.website && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{client.website.replace(/^https?:\/\//, "")}</span>
          </div>
        )}
        <div className="flex items-center justify-end pt-1">
          <span className="text-xs text-primary flex items-center gap-1 font-medium">
            View Details <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
