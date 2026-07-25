import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus,
  MousePointerClick,
  MapPin,
  TrendingUp,
  Play,
  Pause,
  MoreHorizontal,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewCtrCampaignModal } from "@/components/ctr/NewCtrCampaignModal";

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return (
      <Badge className="bg-green-500/15 text-green-400 border-green-500/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Active
      </Badge>
    );
  if (status === "paused")
    return (
      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1">
        <Pause className="h-3 w-3" /> Paused
      </Badge>
    );
  return (
    <Badge className="bg-muted text-muted-foreground gap-1">
      <Clock className="h-3 w-3" /> {status}
    </Badge>
  );
}

export default function CtrCampaigns() {
  const [, setLocation] = useLocation();
  const [showNewModal, setShowNewModal] = useState(false);

  const { data: campaigns = [], isLoading, refetch } = trpc.ctr.listCampaigns.useQuery();
  const updateStatus = trpc.ctr.updateCampaignStatus.useMutation({ onSuccess: () => refetch() });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CTR Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            GBP click-through rate campaigns — real browser sessions only
          </p>
        </div>
        <Button onClick={() => setShowNewModal(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Play className="h-4 w-4 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{campaigns.filter((c: any) => c.status === "active").length}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <MousePointerClick className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{campaigns.length}</p>
                <p className="text-xs text-muted-foreground">Total Campaigns</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {campaigns.reduce((sum: number, c: any) => sum + (c.weeklyRampPct ?? 5), 0) / Math.max(campaigns.length, 1)}%
                </p>
                <p className="text-xs text-muted-foreground">Avg Weekly Ramp</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaign list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <MousePointerClick className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No CTR campaigns yet</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Create your first campaign to start sending real browser sessions to a GBP listing
            </p>
            <Button onClick={() => setShowNewModal(true)} className="mt-2 gap-2">
              <Plus className="h-4 w-4" />
              New Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign: any) => (
            <Card
              key={campaign.id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setLocation(`/ctr/campaigns/${campaign.id}`)}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{campaign.businessName}</p>
                        <StatusBadge status={campaign.status} />
                        {campaign.gscSiteUrl && (
                          <Badge variant="outline" className="text-xs gap-1 text-green-400 border-green-500/30">
                            <CheckCircle2 className="h-2.5 w-2.5" /> GSC Connected
                          </Badge>
                        )}
                        {!campaign.gscSiteUrl && (
                          <Badge variant="outline" className="text-xs gap-1 text-amber-400 border-amber-500/30">
                            <AlertCircle className="h-2.5 w-2.5" /> No GSC
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        {campaign.targetCity && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {campaign.targetCity}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          {campaign.weeklyRampPct}% weekly ramp
                        </span>
                        <span>{campaign.keywordCount ?? 0} keywords</span>
                        <span>{campaign.sessionCount ?? 0} sessions run</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            updateStatus.mutate({
                              id: campaign.id,
                              status: campaign.status === "active" ? "paused" : "active",
                            })
                          }
                        >
                          {campaign.status === "active" ? (
                            <><Pause className="mr-2 h-4 w-4" /> Pause</>
                          ) : (
                            <><Play className="mr-2 h-4 w-4" /> Resume</>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showNewModal && (
        <NewCtrCampaignModal
          open={showNewModal}
          onClose={() => setShowNewModal(false)}
          onCreated={() => { setShowNewModal(false); refetch(); }}
        />
      )}
    </div>
  );
}
