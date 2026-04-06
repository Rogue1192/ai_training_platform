import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Building2, MapPin, Globe, ArrowRight,
  TrendingUp, AlertCircle, CheckCircle, Clock, Settings
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ElementType }> = {
  trial:    { label: "Trial",    variant: "secondary", icon: Clock },
  active:   { label: "Active",   variant: "default",   icon: CheckCircle },
  paused:   { label: "Paused",   variant: "outline",   icon: AlertCircle },
  expired:  { label: "Expired",  variant: "destructive", icon: AlertCircle },
};

export default function AgencyPortal() {
  const [, navigate] = useLocation();

  const { data: agency, isLoading: agencyLoading } = trpc.agency.myAgency.useQuery();
  const { data: clients, isLoading: clientsLoading } = trpc.agency.myClients.useQuery();

  const isLoading = agencyLoading || clientsLoading;

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

  const activeClients = clients?.filter((c: any) => c.trialStatus === "active" || !c.trialStatus) ?? [];
  const trialClients  = clients?.filter((c: any) => c.trialStatus === "trial") ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {agency.brandName || agency.name}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Agency Portal — {clients?.length ?? 0} client{clients?.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/agency/settings")}>
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Clients" value={clients?.length ?? 0} icon={Building2} />
        <StatCard label="Active" value={activeClients.length} icon={CheckCircle} color="text-green-500" />
        <StatCard label="On Trial" value={trialClients.length} icon={Clock} color="text-yellow-500" />
        <StatCard
          label="Package"
          value={agency.packageTier.charAt(0).toUpperCase() + agency.packageTier.slice(1)}
          icon={TrendingUp}
        />
      </div>

      {/* Client list */}
      {!clients?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="font-medium">No clients yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your clients will appear here once they are added to your agency account.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Your Clients
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client: any) => (
              <ClientCard
                key={client.id}
                client={client}
                onClick={() => navigate(`/agency/clients/${client.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, color = "text-foreground"
}: {
  label: string; value: string | number; icon: React.ElementType; color?: string;
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

function ClientCard({ client, onClick }: { client: any; onClick: () => void }) {
  const status = client.trialStatus ?? "active";
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  const StatusIcon = cfg.icon;

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">{client.name}</CardTitle>
          <Badge variant={cfg.variant} className="shrink-0 text-xs">
            <StatusIcon className="h-3 w-3 mr-1" />
            {cfg.label}
          </Badge>
        </div>
        {client.businessType && (
          <CardDescription className="text-xs">{client.businessType}</CardDescription>
        )}
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
