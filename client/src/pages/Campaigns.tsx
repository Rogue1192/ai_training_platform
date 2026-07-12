import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import NewCampaignModal from "@/components/NewCampaignModal";
import { Button } from "@/components/ui/button";
import {
  Rocket,
  Plus,
  Search,
  Filter,
  Loader2,
  ChevronRight,
  Globe,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Eye,
  Copy,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  keyword_research: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  credibility_research: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  content_generation: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  publishing: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  indexing: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  baseline_check: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  training: "bg-primary/10 text-primary border-primary/20",
  monitoring: "bg-green-500/10 text-green-500 border-green-500/20",
  paused: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/20",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  keyword_research: "Keyword Research",
  credibility_research: "Credibility Research",
  content_generation: "Content Generation",
  publishing: "Publishing",
  indexing: "Indexing",
  baseline_check: "Baseline Check",
  training: "Training",
  monitoring: "Monitoring",
  paused: "Paused",
  error: "Error",
};

const statusIcons: Record<string, any> = {
  pending: Clock,
  keyword_research: Search,
  credibility_research: Eye,
  content_generation: Zap,
  publishing: Globe,
  indexing: Globe,
  baseline_check: Eye,
  training: Zap,
  monitoring: CheckCircle2,
  paused: Clock,
  error: AlertTriangle,
};

export default function Campaigns() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);

  const { data: campaigns, isLoading } = trpc.campaign.list.useQuery();
  const { data: stats } = trpc.campaign.stats.useQuery();

  const filteredCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return campaigns.filter((c: any) => {
      const matchesSearch =
        !searchQuery ||
        c.campaignName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.businessName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = !statusFilter || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, searchQuery, statusFilter]);

  const webhookUrl = `${window.location.origin}/api/webhooks/onboarding`;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <NewCampaignModal
        open={showNewCampaignModal}
        onClose={() => setShowNewCampaignModal(false)}
        onSuccess={(campaignId) => navigate(`/campaigns/${campaignId}`)}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-3xl font-bold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Campaigns
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage automated AI visibility campaigns
          </p>
        </div>
        <Button onClick={() => setShowNewCampaignModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns by business name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={statusFilter ? "default" : "outline"}
          onClick={() => setStatusFilter(null)}
        >
          <Filter className="h-4 w-4 mr-2" />
          {statusFilter ? statusLabels[statusFilter] || "All" : "All"}
        </Button>
      </div>

      {/* Pipeline Status Overview — only show meaningful top-level states */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(statusLabels).filter(([key]) => ["pending", "training", "monitoring", "paused", "error"].includes(key)).map(([key, label]) => {
          const count = stats?.[key] ?? 0;
          const isActive = statusFilter === key;
          return (
            <Card
              key={key}
              className={`bg-card border-border cursor-pointer transition-all hover:border-primary/30 ${
                isActive ? "ring-1 ring-primary border-primary/50" : ""
              }`}
              onClick={() =>
                setStatusFilter(isActive ? null : key)
              }
            >
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-foreground">
                  {count}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {label}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Campaign List */}
      {filteredCampaigns.length > 0 ? (
        <div className="space-y-3">
          {filteredCampaigns.map((campaign: any) => {
            const StatusIcon =
              statusIcons[campaign.status] || Clock;
            return (
              <Card
                key={campaign.id}
                className={`bg-card transition-all cursor-pointer ${
                  campaign.isBlocked
                    ? "border-orange-500/60 hover:border-orange-400"
                    : "border-border hover:border-primary/20"
                }`}
                onClick={() => navigate(`/campaigns/${campaign.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          statusColors[campaign.status]?.split(" ")[0] ||
                          "bg-muted"
                        }`}
                      >
                        <StatusIcon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-foreground truncate">
                            {campaign.campaignName}
                          </h3>
                          <Badge
                            variant="outline"
                            className={
                              statusColors[campaign.status] || ""
                            }
                          >
                            {statusLabels[campaign.status] ||
                              campaign.status}
                          </Badge>
                          {campaign.isBlocked && (() => {
                            const missing: string[] = [];
                            if (campaign.llmTxtVerified === false) missing.push('llm.txt');
                            if (campaign.schemaVerified === false) missing.push('Schema');
                            if (campaign.status === 'publishing' && !campaign.publishingCompletedAt && missing.length === 0) missing.push('Content URLs');
                            return (
                              <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                {missing.length > 0 ? `Missing: ${missing.join(' + ')}` : 'Action Required'}
                              </Badge>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Globe className="w-3.5 h-3.5" />
                            {campaign.businessName}
                          </span>
                          {campaign.website && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5" />
                              {campaign.website}
                            </span>
                          )}

                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(campaign.createdAt).toLocaleDateString()}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Pipeline Progress */}
                  {campaign.status !== "pending" && (
                    <div className="mt-3 flex gap-1">
                      {[
                        {
                          key: "keyword_research",
                          done: !!campaign.keywordResearchCompletedAt,
                        },
                        {
                          key: "credibility_research",
                          done: !!campaign.credibilityResearchCompletedAt,
                        },
                        {
                          key: "content_generation",
                          done: !!campaign.contentGenerationCompletedAt,
                        },
                        {
                          key: "publishing",
                          done: !!campaign.publishingCompletedAt,
                        },
                        {
                          key: "indexing",
                          done: !!campaign.indexingVerifiedAt,
                        },
                        {
                          key: "baseline_check",
                          done: !!campaign.baselineCheckCompletedAt,
                        },
                        {
                          key: "training",
                          done: !!campaign.trainingStartedAt,
                        },
                      ].map((step) => (
                        <div
                          key={step.key}
                          className={`h-1.5 flex-1 rounded-full ${
                            step.done
                              ? "bg-primary"
                              : "bg-muted"
                          }`}
                          title={statusLabels[step.key]}
                        />
                      ))}
                    </div>
                  )}

                  {/* Error display */}
                  {campaign.lastError && (
                    <div className="mt-2 p-2 bg-destructive/5 border border-destructive/20 rounded text-xs text-destructive">
                      <AlertTriangle className="w-3 h-3 inline mr-1" />
                      {campaign.lastError}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : campaigns && campaigns.length > 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-1">
              No matching campaigns
            </h3>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search or filter criteria.
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Empty State */
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Rocket className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No campaigns yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Create a campaign manually using the <strong>New Campaign</strong> button above,
              or configure your GHL webhook to auto-create campaigns from client intake forms.
            </p>
            <div className="bg-muted rounded-lg p-4 text-left max-w-lg w-full">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Webhook Endpoint
              </p>
              <div className="flex items-center gap-2">
                <code className="text-sm text-foreground break-all flex-1">
                  POST {webhookUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    toast.success("Webhook URL copied to clipboard");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Send business name, website URL, industry, locations, package
                tier, and contact email.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
