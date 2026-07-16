/**
 * Shared Visibility Report Components
 *
 * These components are used by BOTH the client-facing report (ClientDashboard)
 * and the internal Prospect Audit results page. They must never diverge — any
 * visual change here applies to both surfaces simultaneously.
 */

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  Legend,
} from "recharts";
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
  Target,
  Bot,
  Anchor,
  Award,
} from "lucide-react";

// ─── Score Color Utilities ────────────────────────────────────────────────────

export function getScoreColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#84cc16";
  if (score >= 30) return "#eab308";
  if (score >= 15) return "#f97316";
  return "#ef4444";
}

export function getScoreGradient(score: number): [string, string] {
  if (score >= 70) return ["#22c55e", "#16a34a"];
  if (score >= 50) return ["#84cc16", "#65a30d"];
  if (score >= 30) return ["#eab308", "#ca8a04"];
  if (score >= 15) return ["#f97316", "#ea580c"];
  return ["#ef4444", "#dc2626"];
}

export function getScoreLabel(score: number): string {
  if (score >= 80) return "Dominating";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Growing";
  if (score >= 20) return "Emerging";
  if (score >= 5) return "Barely Visible";
  return "Invisible";
}

export function getScoreGlow(score: number): string {
  if (score >= 70) return "0 0 60px rgba(34, 197, 94, 0.5), 0 0 120px rgba(34, 197, 94, 0.2)";
  if (score >= 50) return "0 0 40px rgba(132, 204, 22, 0.4), 0 0 80px rgba(132, 204, 22, 0.15)";
  if (score >= 30) return "0 0 30px rgba(234, 179, 8, 0.3)";
  if (score >= 15) return "0 0 20px rgba(249, 115, 22, 0.2)";
  return "0 0 10px rgba(239, 68, 68, 0.1)";
}

export function getChangeIcon(change: string) {
  switch (change) {
    case "new": return <Sparkles className="w-4 h-4 text-emerald-400" />;
    case "improved": return <ChevronUp className="w-4 h-4 text-green-400" />;
    case "same": return <Minus className="w-4 h-4 text-gray-400" />;
    case "declined": return <ChevronDown className="w-4 h-4 text-orange-400" />;
    case "lost": return <ChevronDown className="w-4 h-4 text-red-400" />;
    default: return <EyeOff className="w-4 h-4 text-gray-600" />;
  }
}

export function getChangeBadge(change: string) {
  const styles: Record<string, string> = {
    new: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    improved: "bg-green-500/20 text-green-300 border-green-500/30",
    same: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    declined: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    lost: "bg-red-500/20 text-red-300 border-red-500/30",
    never: "bg-gray-800/50 text-gray-600 border-gray-700/30",
  };
  const labels: Record<string, string> = {
    new: "NEW",
    improved: "UP",
    same: "MAINTAINED",
    declined: "DOWN",
    lost: "LOST",
    never: "--",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${styles[change] || styles.never}`}>
      {getChangeIcon(change)}
      {labels[change] || "--"}
    </span>
  );
}

// ─── Animated Score Gauge ─────────────────────────────────────────────────────

export function VisibilityGauge({
  score,
  size = 200,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const color = getScoreColor(score);
  const glow = getScoreGlow(score);
  const scoreLabel = getScoreLabel(score);

  useEffect(() => {
    const duration = 2000;
    const steps = 60;
    const increment = score / steps;
    let current = 0;
    const interval = setInterval(() => {
      current += increment;
      if (current >= score) {
        setAnimatedScore(score);
        clearInterval(interval);
      } else {
        setAnimatedScore(Math.round(current));
      }
    }, duration / steps);
    return () => clearInterval(interval);
  }, [score]);

  const circumference = 2 * Math.PI * 80;
  const strokeDashoffset =
    circumference - (animatedScore / 100) * circumference * 0.75;

  return (
    <div className="relative flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        className="transform -rotate-[135deg]"
      >
        <circle
          cx="100" cy="100" r="80"
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="12"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeLinecap="round"
        />
        <motion.circle
          cx="100" cy="100" r="80"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 2, ease: "easeOut" }}
          style={{ filter: `drop-shadow(${glow.split(",")[0]})` }}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ paddingTop: size * 0.05 }}
      >
        <motion.span
          className="font-heading font-bold"
          style={{
            fontSize: size * 0.3,
            color,
            textShadow: glow,
            opacity: Math.max(0.3, animatedScore / 100),
          }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: Math.max(0.3, score / 100), scale: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        >
          {animatedScore}
        </motion.span>
        <span className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
          {scoreLabel}
        </span>
        {label && (
          <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>
        )}
      </div>
    </div>
  );
}

// ─── Platform Breakdown Radial ────────────────────────────────────────────────

export function PlatformBreakdown({ score }: { score: any }) {
  const data = [
    { name: "AI Overview", value: score.aiOverview, fill: "#f97316" },
    { name: "Gemini", value: score.gemini, fill: "#a855f7" },
    { name: "ChatGPT", value: score.chatgpt, fill: "#3b82f6" },
  ];

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={160} height={160}>
        <RadialBarChart
          cx="50%" cy="50%"
          innerRadius="30%" outerRadius="90%"
          data={data}
          startAngle={180}
          endAngle={0}
        >
          <RadialBar
            background={{ fill: "rgba(255,255,255,0.03)" } as any}
            dataKey="value"
            cornerRadius={4}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="space-y-3">
        {[...data].reverse().map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
            <span className="text-xs text-muted-foreground w-20">{d.name}</span>
            <span className="text-sm font-bold" style={{ color: d.fill }}>
              {d.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Score Comparison Card ────────────────────────────────────────────────────

export function ScoreComparisonCard({
  title,
  current,
  baseline,
  icon: Icon,
  platformColor,
}: {
  title: string;
  current: number;
  baseline: number | null;
  icon: React.ElementType;
  platformColor?: string;
}) {
  const diff = baseline !== null ? current - baseline : current;
  const color = getScoreColor(current);
  const isPositive = diff > 0;
  const accentColor = platformColor ?? color;

  return (
    <motion.div
      className="relative overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-white/[0.03] to-white/[0.01] p-5"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div
        className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20"
        style={{ background: accentColor }}
      />
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
          <span className="text-sm font-medium" style={{ color: accentColor }}>
            {title}
          </span>
        </div>
        {baseline !== null && (
          <span
            className={`flex items-center gap-1 text-xs font-bold ${
              isPositive
                ? "text-emerald-400"
                : diff < 0
                ? "text-red-400"
                : "text-gray-500"
            }`}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : diff < 0 ? (
              <TrendingDown className="w-3 h-3" />
            ) : null}
            {isPositive ? "+" : ""}
            {diff}
          </span>
        )}
      </div>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-heading font-bold" style={{ color }}>
          {current}
        </span>
        {baseline !== null && (
          <span className="text-sm text-muted-foreground mb-1">
            from{" "}
            <span
              className="font-mono"
              style={{ color: getScoreColor(baseline), opacity: 0.7 }}
            >
              {baseline}
            </span>
          </span>
        )}
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${getScoreGradient(current).join(", ")})`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${current}%` }}
          transition={{ duration: 1.5, ease: "easeOut", delay: 0.3 }}
        />
      </div>
    </motion.div>
  );
}

// ─── Win Card ─────────────────────────────────────────────────────────────────

export function WinCard({ win, index }: { win: any; index: number }) {
  const platformLabels: Record<string, string> = {
    chatgpt: "ChatGPT",
    gemini: "Gemini",
    aiOverview: "AI Overview",
  };
  const platformIcons: Record<string, React.ElementType> = {
    chatgpt: Bot,
    gemini: Sparkles,
    aiOverview: Eye,
  };
  const platformColors: Record<string, string> = {
    chatgpt: "#3b82f6",
    gemini: "#a855f7",
    aiOverview: "#f97316",
  };
  const PlatformIcon = platformIcons[win.platform] || Sparkles;
  const platformColor = platformColors[win.platform] || "#34d399";
  const firstSeenDate = win.firstMentionedAt
    ? new Date(win.firstMentionedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : win.detectedAt
    ? new Date(win.detectedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <motion.div
      className="relative overflow-hidden rounded-lg border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-transparent p-4"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.4) }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <Trophy className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <PlatformIcon className="w-3.5 h-3.5" style={{ color: platformColor }} />
            <span
              className="text-xs font-bold uppercase"
              style={{ color: platformColor }}
            >
              {platformLabels[win.platform] || win.platform}
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-bold"
              style={{
                background: `${platformColor}22`,
                color: platformColor,
              }}
            >
              NEW MENTION
            </span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">
            {win.searchQuery}
          </p>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-xs text-muted-foreground">
              {win.previousValue} →{" "}
              <span className="text-emerald-300 font-medium">
                {win.currentValue}
              </span>
            </p>
            {firstSeenDate && (
              <p className="text-[10px] text-muted-foreground/60 shrink-0 ml-2">
                First seen {firstSeenDate}
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Wins Section ─────────────────────────────────────────────────────────────

export function WinsSection({ wins }: { wins: any[] }) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_COUNT = 8;
  const visibleWins = showAll ? wins : wins.slice(0, INITIAL_COUNT);
  const hasMore = wins.length > INITIAL_COUNT;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      <h2 className="text-lg font-heading font-bold text-white mb-4 flex items-center gap-2">
        <Trophy className="w-5 h-5 text-emerald-400" />
        Recent Wins
        <span className="text-xs font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">
          {wins.length}
        </span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visibleWins.map((win: any, i: number) => (
          <WinCard
            key={`${win.queryLocationId}-${win.platform}`}
            win={win}
            index={i}
          />
        ))}
      </div>
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm font-medium hover:bg-emerald-500/20 transition-colors"
          >
            {showAll ? (
              <>
                <ChevronUp className="w-4 h-4" /> Show Less
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" /> See {wins.length - INITIAL_COUNT} More Wins
              </>
            )}
          </button>
        </div>
      )}
    </motion.section>
  );
}

// ─── Visibility Trend Chart ───────────────────────────────────────────────────

export function VisibilityTrendChart({ trends }: { trends: any[] }) {
  if (!trends || trends.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Trend data will appear after the first rank check
      </div>
    );
  }

  // With only one data point there's nothing to draw a line between — show a
  // clean message instead of a single floating dot.
  if (trends.length === 1) {
    const t = trends[0];
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          This is your Day 0 baseline — the trend graph will build as weekly checks run.
        </p>
        <div className="flex items-center gap-6 text-sm">
          <span className="text-green-400 font-semibold">Overall: {t.overall}</span>
          <span className="text-blue-400">ChatGPT: {t.chatgpt}</span>
          <span className="text-purple-400">Gemini: {t.gemini}</span>
          <span className="text-orange-400">AI Overview: {t.aiOverview}</span>
        </div>
      </div>
    );
  }

  const chartData = trends.map((t) => ({
    ...t,
    date: new Date(t.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={chartData}
        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.05)"
        />
        <XAxis
          dataKey="date"
          tick={{ fill: "#6b7280", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#6b7280", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#e2e8f0",
          }}
        />
        <Line
          type="monotone"
          dataKey="overall"
          stroke="#22c55e"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4 }}
          name="Overall"
        />
        <Line
          type="monotone"
          dataKey="chatgpt"
          stroke="#3b82f6"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
          name="ChatGPT"
        />
        <Line
          type="monotone"
          dataKey="gemini"
          stroke="#a855f7"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
          name="Gemini"
        />
        <Line
          type="monotone"
          dataKey="aiOverview"
          stroke="#f97316"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
          name="AI Overview"
        />
        <Legend
          wrapperStyle={{ fontSize: "11px", color: "#9ca3af" }}
          iconType="circle"
          iconSize={8}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Query Details Table ──────────────────────────────────────────────────────

// ─── Rank / sentiment cell helper ────────────────────────────────────────────
function PlatformCell({
  mentioned,
  rank,
  citedUrl,
  sentiment,
  change,
  accentColor,
}: {
  mentioned: boolean;
  rank?: number | null;
  citedUrl?: boolean;
  sentiment?: string | null;
  change?: string;
  accentColor: string; // tailwind text-color class e.g. "text-green-400"
}) {
  const sentimentColor =
    sentiment === "positive" ? "text-green-400 bg-green-400/10" :
    sentiment === "negative" ? "text-red-400 bg-red-400/10" :
    "text-yellow-400 bg-yellow-400/10";

  return (
    <div className="flex flex-col items-center gap-1">
      {mentioned ? (
        <>
          {/* Rank badge — shows #N if in a list, or just the eye icon if mentioned but not ranked */}
          {rank != null ? (
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${accentColor} bg-white/5`}>
              #{rank}
            </span>
          ) : (
            <Eye className={`w-4 h-4 ${accentColor}`} />
          )}
          {/* Sentiment chip */}
          {sentiment && (
            <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${sentimentColor}`}>
              {sentiment}
            </span>
          )}
          {/* URL citation dot */}
          {citedUrl && (
            <span className="text-[9px] text-blue-400 font-medium" title="Website cited as source">
              cited
            </span>
          )}
        </>
      ) : (
        <EyeOff className="w-4 h-4 text-gray-700" />
      )}
      {getChangeBadge(change ?? "never")}
    </div>
  );
}

export function QueryDetailsTable({ queries }: { queries: any[] }) {
  const [sortBy, setSortBy] = useState<
    "query" | "chatgpt" | "gemini" | "aiOverview"
  >("query");

  const sorted = useMemo(() => {
    return [...queries].sort((a, b) => {
      if (sortBy === "query") return a.searchQuery.localeCompare(b.searchQuery);
      // Sort: mentioned first, then by rank (lower = better), then unmentioned
      const aM = a[`${sortBy}Mentioned`] ? 1 : 0;
      const bM = b[`${sortBy}Mentioned`] ? 1 : 0;
      if (aM !== bM) return bM - aM;
      const aR = a[`${sortBy}RecommendationRank`] ?? 999;
      const bR = b[`${sortBy}RecommendationRank`] ?? 999;
      return aR - bR;
    });
  }, [queries, sortBy]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            <th
              className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
              onClick={() => setSortBy("query")}
            >
              Search Query
            </th>
            <th
              className="text-center py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
              onClick={() => setSortBy("chatgpt")}
            >
              <span className="flex items-center justify-center gap-1">
                <Bot className="w-3 h-3" /> ChatGPT
              </span>
            </th>
            <th
              className="text-center py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
              onClick={() => setSortBy("gemini")}
            >
              <span className="flex items-center justify-center gap-1">
                <Sparkles className="w-3 h-3" /> Gemini
              </span>
            </th>
            <th
              className="text-center py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
              onClick={() => setSortBy("aiOverview")}
            >
              <span className="flex items-center justify-center gap-1">
                <Eye className="w-3 h-3" /> AI Overview
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((q, i) => (
            <motion.tr
              key={q.queryLocationId ?? q.searchQuery}
              className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.02 }}
            >
              <td className="py-3 px-3">
                <div className="font-medium text-foreground">
                  {q.searchQuery}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {q.location}
                </div>
              </td>
              <td className="text-center py-3 px-2">
                <PlatformCell
                  mentioned={q.chatgptMentioned}
                  rank={q.chatgptRecommendationRank}
                  citedUrl={q.chatgptCitedUrl}
                  sentiment={q.chatgptSentiment}
                  change={q.chatgptChange}
                  accentColor="text-green-400"
                />
              </td>
              <td className="text-center py-3 px-2">
                <PlatformCell
                  mentioned={q.geminiMentioned}
                  rank={q.geminiRecommendationRank}
                  citedUrl={q.geminiCitedUrl}
                  sentiment={q.geminiSentiment}
                  change={q.geminiChange}
                  accentColor="text-purple-400"
                />
              </td>
              <td className="text-center py-3 px-2">
                <PlatformCell
                  mentioned={q.aiOverviewMentioned}
                  rank={q.aiOverviewRecommendationRank}
                  citedUrl={q.aiOverviewCitedUrl}
                  sentiment={q.aiOverviewSentiment}
                  change={q.aiOverviewChange}
                  accentColor="text-orange-400"
                />
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Baseline Score Cards ─────────────────────────────────────────────────────

export function BaselineScoreCards({
  score,
  establishedAt,
}: {
  score: {
    overall: number;
    chatgpt: number;
    gemini: number;
    aiOverview: number;
  };
  establishedAt?: Date | string | null;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent p-5 sm:p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-heading font-bold text-white flex items-center gap-2">
          <Anchor className="w-4 h-4 text-blue-400" />
          Starting Baseline
        </h2>
        {establishedAt && (
          <span className="text-xs text-muted-foreground">
            Established{" "}
            {new Date(establishedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(
          [
            {
              label: "Overall",
              value: score.overall,
              color: getScoreColor(score.overall),
            },
            { label: "ChatGPT", value: score.chatgpt, color: "#3b82f6" },
            { label: "Gemini", value: score.gemini, color: "#a855f7" },
            { label: "AI Overview", value: score.aiOverview, color: "#f97316" },
          ] as { label: string; value: number; color: string }[]
        ).map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center"
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              {label}
            </p>
            <p className="text-2xl font-heading font-bold" style={{ color }}>
              {value}
            </p>
            <p className="text-[10px] text-gray-300 mt-1">at start</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-300 mt-3">
        These numbers reflect your AI visibility when we first started. They are
        locked and will never change.
      </p>
    </motion.section>
  );
}

// ─── Report Header ────────────────────────────────────────────────────────────

export function ReportHeader({
  title,
  website,
  lastUpdated,
}: {
  title: string;
  website?: string | null;
  lastUpdated?: Date | string | null;
}) {
  return (
    <header className="border-b border-white/5 bg-gradient-to-r from-[#0a0f1e] via-[#0f172a] to-[#0a0f1e]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <svg
                className="w-5 h-5 text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">
                AI Visibility Report
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-white">
              {title}
            </h1>
            {website && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                {website}
              </p>
            )}
          </div>
          {lastUpdated && (
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground">Last updated</p>
              <p className="text-sm font-medium">
                {new Date(lastUpdated).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── Report Footer ────────────────────────────────────────────────────────────

export function ReportFooter() {
  return (
    <footer className="text-center py-8 border-t border-white/5">
      <div className="flex items-center justify-center gap-2 mb-2">
        <svg
          className="w-4 h-4 text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        <span className="text-sm font-heading font-bold text-blue-400">
          AI Answer Forge
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Powered by Rogue Business Marketing
      </p>
    </footer>
  );
}
