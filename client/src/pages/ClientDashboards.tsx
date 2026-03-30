/**
 * Admin page for managing client dashboard links.
 * Create, view, toggle, and copy dashboard URLs for clients.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Link2,
  Plus,
  Copy,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  BarChart3,
  Clock,
} from "lucide-react";

export default function ClientDashboards() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [dashboardTitle, setDashboardTitle] = useState("");

  const { data: dashboards, isLoading, refetch } = trpc.clientDashboard.list.useQuery();
  const { data: businessList } = trpc.business.list.useQuery();
  const { data: campaignList } = trpc.campaign.list.useQuery();

  const createMutation = trpc.clientDashboard.create.useMutation({
    onSuccess: () => {
      toast.success("Dashboard link created");
      setCreateOpen(false);
      setSelectedBusinessId("");
      setSelectedCampaignId("");
      setDashboardTitle("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = trpc.clientDashboard.toggleActive.useMutation({
    onSuccess: () => {
      toast.success("Dashboard updated");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  function getDashboardUrl(token: string) {
    return `${window.location.origin}/report/${token}`;
  }

  function copyUrl(token: string) {
    navigator.clipboard.writeText(getDashboardUrl(token));
    toast.success("Dashboard URL copied to clipboard");
  }

  const filteredCampaigns = campaignList?.filter(
    (c: any) => !selectedBusinessId || c.businessId === Number(selectedBusinessId)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Client Dashboards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage client-facing visibility report links
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Dashboard Link
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Client Dashboard</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <Label>Business</Label>
                <Select value={selectedBusinessId} onValueChange={setSelectedBusinessId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a business" />
                  </SelectTrigger>
                  <SelectContent>
                    {businessList?.map((b: any) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Campaign (optional)</Label>
                <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No campaign</SelectItem>
                    {filteredCampaigns?.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name || `Campaign #${c.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Dashboard Title (optional)</Label>
                <Input
                  value={dashboardTitle}
                  onChange={(e) => setDashboardTitle(e.target.value)}
                  placeholder="e.g., Smith Plumbing - AI Visibility Report"
                />
              </div>
              <Button
                className="w-full"
                disabled={!selectedBusinessId || createMutation.isPending}
                onClick={() => {
                  createMutation.mutate({
                    businessId: Number(selectedBusinessId),
                    campaignId: selectedCampaignId && selectedCampaignId !== "none" ? Number(selectedCampaignId) : undefined,
                    dashboardTitle: dashboardTitle || undefined,
                  });
                }}
              >
                {createMutation.isPending ? "Creating..." : "Create Dashboard Link"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading dashboards...
          </CardContent>
        </Card>
      ) : !dashboards?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Link2 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No client dashboards created yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Create a dashboard link to share visibility reports with clients
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Dashboards</CardTitle>
            <CardDescription>{dashboards.length} dashboard{dashboards.length !== 1 ? "s" : ""} created</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Views</TableHead>
                  <TableHead className="text-center">Last Viewed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboards.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.businessName || `Business #${d.businessId}`}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.dashboardTitle || "Untitled"}
                    </TableCell>
                    <TableCell className="text-center">
                      {d.isActive ? (
                        <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                          <Eye className="w-3 h-3 mr-1" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-gray-500/20 text-gray-400">
                          <EyeOff className="w-3 h-3 mr-1" /> Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="flex items-center justify-center gap-1 text-sm">
                        <BarChart3 className="w-3 h-3 text-muted-foreground" />
                        {d.accessCount || 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {d.lastAccessedAt ? (
                        <span className="flex items-center justify-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(d.lastAccessedAt).toLocaleDateString()}
                        </span>
                      ) : (
                        "Never"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyUrl(d.accessToken)}
                          title="Copy URL"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(getDashboardUrl(d.accessToken), "_blank")}
                          title="Open dashboard"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleMutation.mutate({ id: d.id, isActive: !d.isActive })}
                          title={d.isActive ? "Disable" : "Enable"}
                        >
                          {d.isActive ? (
                            <ToggleRight className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="w-4 h-4 text-gray-500" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
