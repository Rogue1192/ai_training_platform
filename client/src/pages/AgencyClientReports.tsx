import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, FileBarChart, Globe, Eye, Calendar, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AgencyClientReports() {
  const { data: dashboards, isLoading } = trpc.agency.myClientDashboards.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const getReportUrl = (token: string) =>
    `${window.location.origin}/report/${token}`;

  const handleCopy = (token: string, businessName: string) => {
    navigator.clipboard.writeText(getReportUrl(token));
    toast.success(`Report link copied for ${businessName}`);
  };

  const handleOpen = (token: string) => {
    window.open(getReportUrl(token), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Client Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Share these links with your clients to show their AI visibility progress.
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-5 space-y-3">
                <div className="h-4 bg-muted rounded w-2/3" />
                <div className="h-3 bg-muted rounded w-1/2" />
                <div className="h-8 bg-muted rounded w-full mt-4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && (!dashboards || dashboards.length === 0) && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FileBarChart className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No client reports yet</p>
            <p className="text-sm mt-1">
              Reports are generated automatically once a campaign is active and tracking.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && dashboards && dashboards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {dashboards.map((d: any) => (
            <Card
              key={d.id}
              className="border border-border hover:border-muted-foreground/40 transition-colors"
            >
              <CardContent className="p-5 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate">
                      {d.businessName ?? d.dashboardTitle ?? "Unnamed Client"}
                    </p>
                    {d.businessWebsite && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground truncate">
                          {d.businessWebsite.replace(/^https?:\/\//, "")}
                        </span>
                      </div>
                    )}
                  </div>
                  <Badge
                    variant={d.isActive ? "default" : "secondary"}
                    className={`shrink-0 text-xs ${d.isActive ? "bg-green-500/15 text-green-400 border-green-500/30" : ""}`}
                  >
                    {d.isActive ? (
                      <><CheckCircle className="h-3 w-3 mr-1" /> Active</>
                    ) : (
                      <><XCircle className="h-3 w-3 mr-1" /> Disabled</>
                    )}
                  </Badge>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {d.accessCount != null && (
                    <div className="flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" />
                      <span>{d.accessCount} view{d.accessCount !== 1 ? "s" : ""}</span>
                    </div>
                  )}
                  {d.lastAccessedAt && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>Last viewed {format(new Date(d.lastAccessedAt), "MMM d, yyyy")}</span>
                    </div>
                  )}
                  {!d.lastAccessedAt && (
                    <span className="italic">Not yet viewed</span>
                  )}
                </div>

                {/* Report URL preview */}
                <div className="rounded-md bg-muted/30 border border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {window.location.origin}/report/{d.accessToken?.slice(0, 16)}…
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => handleCopy(d.accessToken, d.businessName ?? "client")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Report Link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => handleOpen(d.accessToken)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
