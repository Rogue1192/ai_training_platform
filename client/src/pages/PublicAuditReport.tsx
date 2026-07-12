/**
 * PublicAuditReport.tsx
 *
 * A publicly accessible, read-only view of a completed AI Visibility Audit.
 * Accessed via /audit/:token — no login required.
 *
 * Renders the same visual components as the ProspectAudit results page and
 * the ClientDashboard so the prospect sees a consistent, professional report.
 */

import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { motion } from "framer-motion";
import { Loader2, AlertCircle, TrendingUp } from "lucide-react";
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

// ─── Revenue Calculator ─────────────────────────────────────────────────────

function RevenueCalculator({ avgJobValue, lostOpportunities }: { avgJobValue: number; lostOpportunities: number }) {
  const [captureRate, setCaptureRate] = useState(10);
  const [closeRateInput, setCloseRateInput] = useState("30");
  const closeRate = parseFloat(closeRateInput) || 0;
  const liveRevenueGap =
    closeRate > 0
      ? Math.round(lostOpportunities * (captureRate / 100) * (closeRate / 100) * avgJobValue * 12)
      : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.03] to-transparent p-6 sm:p-8"
    >
      <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-green-400" />
        Revenue Opportunity Calculator
      </h2>
      <p className="text-xs text-gray-500 mb-6">
        Adjust the inputs below to model what capturing a portion of this missed visibility could mean for your business.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Your Close Rate</label>
          <div className="relative">
            <input
              type="number" min="1" max="100"
              value={closeRateInput}
              onChange={(e) => setCloseRateInput(e.target.value)}
              placeholder="e.g. 30"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-2xl font-bold text-white placeholder:text-gray-700 focus:outline-none focus:border-green-500/50 transition-all text-center"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg font-bold">%</span>
          </div>
          <p className="text-[11px] text-gray-600 mt-1.5 text-center">% of leads you typically convert to booked jobs</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">AI Search Capture Rate</label>
            <span className="text-2xl font-bold text-white">{captureRate}%</span>
          </div>
          <input
            type="range" min="1" max="60" step="1"
            value={captureRate}
            onChange={(e) => setCaptureRate(parseInt(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{ background: `linear-gradient(to right, #22c55e ${(captureRate / 60) * 100}%, rgba(255,255,255,0.1) ${(captureRate / 60) * 100}%)` }}
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>1%</span><span>30%</span><span>60%</span>
          </div>
          <p className="text-[11px] text-gray-600 mt-1 text-center">% of missed searches you capture as inbound leads</p>
        </div>
      </div>
      <div className="rounded-2xl border border-green-500/25 bg-gradient-to-br from-green-500/10 to-green-900/5 p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-400/5 to-transparent pointer-events-none rounded-2xl" />
        <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-3">Estimated Annual Revenue Opportunity</p>
        {liveRevenueGap !== null && liveRevenueGap > 0 ? (
          <>
            <motion.p
              key={liveRevenueGap}
              initial={{ scale: 0.92, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="text-5xl sm:text-6xl font-bold text-white"
            >
              ${liveRevenueGap.toLocaleString()}
            </motion.p>
            <p className="text-xs text-gray-400 mt-3">
              {lostOpportunities.toLocaleString()} missed searches × {captureRate}% capture × {closeRate}% close × ${avgJobValue.toLocaleString()} avg job × 12 months
            </p>
          </>
        ) : (
          <p className="text-3xl font-bold text-gray-600">Enter your close rate above</p>
        )}
      </div>
      <p className="text-[10px] text-gray-700 text-center mt-3">
        * This is a revenue opportunity model, not a guarantee. Actual results depend on market conditions, service quality, and follow-up processes.
      </p>
    </motion.section>
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

  const avgJobValue = (audit as any).avgJobValue as number | null;

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

        {/* Interactive Revenue Gap Calculator */}
        {avgJobValue && avgJobValue > 0 && lostOpportunities > 0 && (
          <RevenueCalculator
            avgJobValue={avgJobValue}
            lostOpportunities={lostOpportunities}
          />
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
