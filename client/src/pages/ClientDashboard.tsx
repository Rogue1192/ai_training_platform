/**
 * Client Dashboard — Public-facing visibility report
 * Accessible via token URL: /report/:token
 * No login required. Designed to be visually stunning to minimize churn.
 */
import { useState, useEffect, useMemo } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Trophy,
  Eye,
  EyeOff,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Minus,
  Zap,
  Shield,
  Target,
  Award,
  ArrowUpRight,
  Bot,
  Video,
  Play,
  Star,
  Anchor,
} from "lucide-react";
import {
  getScoreColor,
  getScoreGradient,
  getScoreLabel,
  getScoreGlow,
  getChangeIcon,
  getChangeBadge,
  VisibilityGauge,
  PlatformBreakdown,
  ScoreComparisonCard,
  WinCard,
  WinsSection,
  VisibilityTrendChart,
  QueryDetailsTable,
  BaselineScoreCards,
  ReportHeader,
  ReportFooter,
} from "@/components/VisibilityReportComponents";

// ============= Bonus Wins Banner (client report only — not shown on prospect audit) =============

function BonusWinsBanner({ bonusResults }: { bonusResults: any[] }) {
  const wins = bonusResults.filter((r) => r.isBonusWin);
  if (wins.length === 0) return null;

  const bySource = wins.reduce((acc: Record<string, any[]>, r) => {
    const key = r.sourceSearchQuery || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
    >
      <div className="rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-transparent p-6 mb-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <Star className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h2 className="text-lg font-heading font-bold text-yellow-300">
              Congratulations! You're appearing in {wins.length} bonus {wins.length === 1 ? "query" : "queries"}
            </h2>
            <p className="text-xs text-yellow-400/70">
              These are additional searches where your business is showing up — beyond your core tracked queries.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {Object.entries(bySource).map(([sourceQuery, results]) => (
          <div key={sourceQuery} className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.04] p-4">
            <p className="text-[10px] font-bold text-yellow-500/60 uppercase tracking-widest mb-2">Related to: {sourceQuery}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(results as any[]).map((r: any, i: number) => (
                <div key={i} className="rounded-lg border border-yellow-500/15 bg-yellow-500/[0.04] p-3 flex items-start gap-2">
                  <Star className="w-3.5 h-3.5 text-yellow-400 mt-1 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-yellow-100 leading-snug break-words">{r.bonusSearchQuery}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {r.chatgptMentioned && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">ChatGPT</span>
                      )}
                      {r.geminiMentioned && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">Gemini</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

// ============= Main Dashboard Component =============

export default function ClientDashboard() {
  const params = useParams<{ token: string }>();
  const token = params.token || "";

  const { data, isLoading, error } = trpc.clientDashboard.getByToken.useQuery(
    { token },
    { enabled: !!token, refetchOnWindowFocus: false }
  );

  const { data: bonusResults = [] } = trpc.rankTracking.getBonusResultsByToken.useQuery(
    { token },
    { enabled: !!token, refetchOnWindowFocus: false }
  );

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h1 className="text-xl font-heading font-bold text-gray-400">Dashboard Not Found</h1>
          <p className="text-sm text-gray-600 mt-2">This link may have expired or been deactivated.</p>
        </div>
      </div>
    );
  }

  const { dashboard, business, report } = data;

  if (!report) {
    return (
      <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center">
        <div className="text-center">
          <Target className="w-16 h-16 text-blue-500/50 mx-auto mb-4" />
          <h1 className="text-xl font-heading font-bold text-gray-300">Campaign In Progress</h1>
          <p className="text-sm text-gray-500 mt-2">Your visibility report will appear here once the initial analysis is complete.</p>
        </div>
      </div>
    );
  }

  const currentScore = report.currentScore;
  const baselineScore = report.baselineScore;
  const overallDiff = baselineScore ? currentScore.overall - baselineScore.overall : 0;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-gray-100">
      <ReportHeader
        title={dashboard?.dashboardTitle || business?.name || "Visibility Dashboard"}
        website={business?.website}
        lastUpdated={report.lastCheckAt}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Hero: Overall Score */}
        <motion.section
          className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent p-6 sm:p-10"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Background glow */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-[120px] opacity-20"
            style={{ background: getScoreColor(currentScore.overall) }}
          />

          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="flex flex-col items-center md:items-start">
              <VisibilityGauge score={currentScore.overall} size={220} />
              <div className="mt-4 text-center md:text-left">
                <h2 className="text-lg font-heading font-bold text-white">Overall AI Visibility</h2>

              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Platform Breakdown</h3>
              <PlatformBreakdown score={currentScore} />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/[0.03] p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-white">
                    {currentScore.mentionedQueries} <span className="text-base text-muted-foreground font-normal">/ {currentScore.totalQueries}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Queries Mentioned</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-3 text-center">
                  <p className="text-sm font-heading font-bold text-white">
                    {report.lastCheckAt
                      ? new Date(report.lastCheckAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Report Date</p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Static Baseline — locked-in starting scores, never changes */}
        {baselineScore && (
          <BaselineScoreCards score={baselineScore} establishedAt={report.baselineCheckAt} />
        )}

        {/* Before/After Comparison — only show after at least one post-baseline check */}
        {baselineScore && !report.isBaselineOnly && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h2 className="text-lg font-heading font-bold text-white mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-yellow-400" />
              Before vs. After
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <ScoreComparisonCard title="Overall" current={currentScore.overall} baseline={baselineScore.overall} icon={Target} />
              <ScoreComparisonCard title="ChatGPT" current={currentScore.chatgpt} baseline={baselineScore.chatgpt} icon={Bot} platformColor="#3b82f6" />
              <ScoreComparisonCard title="Gemini" current={currentScore.gemini} baseline={baselineScore.gemini} icon={Sparkles} platformColor="#a855f7" />
              <ScoreComparisonCard title="AI Overview" current={currentScore.aiOverview} baseline={baselineScore.aiOverview} icon={Eye} platformColor="#f97316" />
            </div>
          </motion.section>
        )}

        {/* Wins Section — only show after sprint completes */}
        {!report.isBaselineOnly && report.recentWins.length > 0 && (
          <WinsSection wins={report.recentWins} />
        )}

        {/* Bonus Wins Banner — only show after sprint completes */}
        {!report.isBaselineOnly && <BonusWinsBanner bonusResults={bonusResults} />}

        {/* Visibility Trend */}
        <motion.section
          className="rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <h2 className="text-lg font-heading font-bold text-white mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            Visibility Over Time
          </h2>
          <VisibilityTrendChart trends={report.trends} />
        </motion.section>

        {/* Query Details */}
        <motion.section
          className="rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <h2 className="text-lg font-heading font-bold text-white mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-400" />
            Query-by-Query Breakdown
          </h2>
          <QueryDetailsTable queries={report.queryDetails} />
        </motion.section>

        {/* Footer */}
        <ReportFooter />
      </main>
    </div>
  );
}

// ============= Loading Skeleton =============

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-gray-100">
      <header className="border-b border-white/5 py-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="h-4 w-32 bg-white/5 rounded animate-pulse mb-2" />
          <div className="h-8 w-64 bg-white/5 rounded animate-pulse" />
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-10 h-80 flex items-center justify-center">
          <div className="text-center">
            <div className="w-48 h-48 rounded-full border-4 border-white/5 mx-auto animate-pulse" />
            <div className="h-4 w-32 bg-white/5 rounded animate-pulse mx-auto mt-4" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-5 h-28 animate-pulse" />
          ))}
        </div>
      </main>
    </div>
  );
}
