/**
 * PublicAuditReport.tsx
 *
 * A publicly accessible, read-only view of a completed AI Visibility Audit.
 * Accessed via /audit/:token — no login required.
 *
 * Renders the same visual components as the ProspectAudit results page and
 * the ClientDashboard so the prospect sees a consistent, professional report.
 */

import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, AlertCircle, Zap } from "lucide-react";
import {
  VisibilityGauge,
  PlatformBreakdown,
  BaselineScoreCards,
  QueryDetailsTable,
  ReportHeader,
  ReportFooter,
} from "@/components/VisibilityReportComponents";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = "blue",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "blue" | "purple" | "red";
}) {
  const colors = {
    blue:   "border-blue-500/30 bg-blue-500/10 text-blue-300",
    purple: "border-purple-500/30 bg-purple-500/10 text-purple-300",
    red:    "border-red-500/30 bg-red-500/10 text-red-300",
  };
  const valueColors = {
    blue:   "text-blue-100",
    purple: "text-purple-100",
    red:    "text-red-100",
  };

  return (
    <div className={`rounded-xl border p-5 text-center ${colors[color]}`}>
      <p className="text-xs uppercase tracking-widest font-semibold mb-2 opacity-80">{label}</p>
      <p className={`text-4xl font-black ${valueColors[color]}`}>{value}</p>
      {sub && <p className="text-xs mt-2 opacity-70">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PublicAuditReport() {
  const { token } = useParams<{ token: string }>();

  const { data: audit, isLoading, error } = trpc.prospectAudit.getByShareToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Loading audit report…</p>
        </div>
      </div>
    );
  }

  if (error || !audit) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
          <h2 className="text-lg font-semibold">Report Not Found</h2>
          <p className="text-muted-foreground text-sm">
            This report link may have expired or is no longer available.
          </p>
        </div>
      </div>
    );
  }

  if (audit.status !== "completed") {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Audit is still running…</p>
        </div>
      </div>
    );
  }

  // Parse stored JSON fields
  const snapshots: any[] = (() => {
    try {
      return typeof audit.snapshotResults === "string"
        ? JSON.parse(audit.snapshotResults)
        : (audit.snapshotResults as any[]) ?? [];
    } catch { return []; }
  })();

  const scores = {
    overall: audit.overallScore ?? 0,
    chatgpt: audit.chatgptScore ?? 0,
    gemini: audit.geminiScore ?? 0,
    aiOverview: audit.aiOverviewScore ?? 0,
    queriesMentioned: audit.queriesMentioned ?? 0,
    totalTracked: snapshots.length / 3 || 15,
    totalAISearches: (audit as any).totalAISearches ?? 0,
    visibleSearches: (audit as any).visibleSearches ?? 0,
    lostOpportunities: (audit as any).lostOpportunities ?? 0,
    volumeUsedFallback: (audit as any).volumeUsedFallback ?? false,
  };

  const baselineScores = {
    overall: scores.overall,
    chatgpt: scores.chatgpt,
    gemini: scores.gemini,
    aiOverview: scores.aiOverview,
    establishedAt: audit.completedAt ? new Date(audit.completedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—",
  };

  const queryDetails = snapshots.map((s: any) => ({
    searchQuery: s.searchQuery,
    location: s.location,
    chatgptMentioned: s.chatgptMentioned ?? false,
    geminiMentioned: s.geminiMentioned ?? false,
    aiOverviewMentioned: s.aiOverviewMentioned ?? false,
    chatgptChange: "same" as const,
    geminiChange: "same" as const,
    aiOverviewChange: "same" as const,
  }));

  const totalAISearches = scores.totalAISearches;
  const lostOpportunities = scores.lostOpportunities;
  const visibilityPct = totalAISearches > 0
    ? Math.round((scores.visibleSearches / totalAISearches) * 100)
    : Math.round((scores.queriesMentioned / Math.max(1, scores.totalTracked)) * 100);

  const auditDate = audit.completedAt
    ? new Date(audit.completedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "—";

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <ReportHeader
          title={`${audit.businessName} — AI Visibility Report`}
          website={audit.website ?? null}
          lastUpdated={audit.completedAt}
        />

        {/* Pain-point hero cards */}
        {totalAISearches > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Monthly AI Searches"
              value={totalAISearches.toLocaleString()}
              sub="Estimated searches/month in your area"
              color="blue"
            />
            <StatCard
              label="Your AI Visibility"
              value={`${visibilityPct}%`}
              sub="Of those searches where you were found"
              color="purple"
            />
            <StatCard
              label="Potential Lost Opportunities"
              value={lostOpportunities.toLocaleString()}
              sub="Searches/month where you weren't visible"
              color="red"
            />
          </div>
        )}

        {/* Visibility gauge + platform breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 flex flex-col items-center justify-center gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Overall AI Visibility
            </h3>
            <VisibilityGauge score={scores.overall} size={220} />
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-2xl font-bold">{scores.queriesMentioned}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Queries Mentioned</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{scores.totalTracked}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Tracked</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <PlatformBreakdown score={scores} />
          </div>
        </div>

        {/* Baseline score cards */}
        <BaselineScoreCards
          score={{ overall: baselineScores.overall, chatgpt: baselineScores.chatgpt, gemini: baselineScores.gemini, aiOverview: baselineScores.aiOverview }}
          establishedAt={audit.completedAt}
        />

        {/* Query details table */}
        <QueryDetailsTable queries={queryDetails} />

        {/* Footer */}
        <ReportFooter />

        {/* Volume fallback disclaimer */}
        {scores.volumeUsedFallback && (
          <p className="text-xs text-muted-foreground text-center pb-4">
            * Search volume estimates based on available AI search data. Where direct AI search data
            is unavailable, estimates reflect approximately 25% of Google search volume — consistent
            with current AI search adoption rates for local service queries.
          </p>
        )}
      </div>
    </div>
  );
}
