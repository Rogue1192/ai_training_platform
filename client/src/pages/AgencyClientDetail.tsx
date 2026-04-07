import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Loader2, ArrowLeft, Building2, Globe, MapPin, Phone,
  Mail, TrendingUp, CheckCircle, Clock, AlertCircle, Bell
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

  return (
    <div className="space-y-6">
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
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: any }) {
  const isActive = campaign.isActive;
  const trialStatus = campaign.trialStatus;

  return (
    <Card>
      <CardContent className="flex items-center justify-between py-3 px-4">
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
        </div>
      </CardContent>
    </Card>
  );
}
