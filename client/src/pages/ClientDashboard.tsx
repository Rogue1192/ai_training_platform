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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  BarChart,
  Bar,
  Cell,
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

// ============= Score Color Utilities =============

function getScoreColor(score: number): string {
  if (score >= 70) return "#22c55e"; // Green — dominating
  if (score >= 50) return "#84cc16"; // Lime — strong
  if (score >= 30) return "#eab308"; // Yellow — building
  if (score >= 15) return "#f97316"; // Orange — emerging
  return "#ef4444"; // Red — invisible
}

function getScoreGradient(score: number): [string, string] {
  if (score >= 70) return ["#22c55e", "#16a34a"];
  if (score >= 50) return ["#84cc16", "#65a30d"];
  if (score >= 30) return ["#eab308", "#ca8a04"];
  if (score >= 15) return ["#f97316", "#ea580c"];
  return ["#ef4444", "#dc2626"];
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "Dominating";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Growing";
  if (score >= 20) return "Emerging";
  if (score >= 5) return "Barely Visible";
  return "Invisible";
}

function getScoreGlow(score: number): string {
  if (score >= 70) return "0 0 60px rgba(34, 197, 94, 0.5), 0 0 120px rgba(34, 197, 94, 0.2)";
  if (score >= 50) return "0 0 40px rgba(132, 204, 22, 0.4), 0 0 80px rgba(132, 204, 22, 0.15)";
  if (score >= 30) return "0 0 30px rgba(234, 179, 8, 0.3)";
  if (score >= 15) return "0 0 20px rgba(249, 115, 22, 0.2)";
  return "0 0 10px rgba(239, 68, 68, 0.1)";
}

function getChangeIcon(change: string) {
  switch (change) {
    case "new": return <Sparkles className="w-4 h-4 text-emerald-400" />;
    case "improved": return <ChevronUp className="w-4 h-4 text-green-400" />;
    case "same": return <Minus className="w-4 h-4 text-gray-400" />;
    case "declined": return <ChevronDown className="w-4 h-4 text-orange-400" />;
    case "lost": return <ChevronDown className="w-4 h-4 text-red-400" />;
    default: return <EyeOff className="w-4 h-4 text-gray-600" />;
  }
}

function getChangeBadge(change: string) {
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
    same: "HOLD",
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

// ============= Animated Score Gauge =============

function VisibilityGauge({ score, size = 200, label }: { score: number; size?: number; label?: string }) {
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
  const strokeDashoffset = circumference - (animatedScore / 100) * circumference * 0.75; // 270 degree arc

  return (
    <div className="relative flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 200 200" className="transform -rotate-[135deg]">
        {/* Background arc */}
        <circle
          cx="100" cy="100" r="80"
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="12"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeLinecap="round"
        />
        {/* Score arc */}
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
      {/* Center score */}
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: size * 0.05 }}>
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
        <span className="text-xs text-muted-foreground uppercase tracking-widest mt-1">{scoreLabel}</span>
        {label && <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>}
      </div>
    </div>
  );
}

// ============= Score Comparison Card =============

function ScoreComparisonCard({
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
  // Use platform color for icon/title when provided, otherwise fall back to score color
  const accentColor = platformColor ?? color;

  return (
    <motion.div
      className="relative overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-white/[0.03] to-white/[0.01] p-5"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Glow effect */}
      <div
        className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20"
        style={{ background: accentColor }}
      />
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
          <span className="text-sm font-medium" style={{ color: accentColor }}>{title}</span>
        </div>
        {baseline !== null && (
          <span className={`flex items-center gap-1 text-xs font-bold ${isPositive ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-gray-500"}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : diff < 0 ? <TrendingDown className="w-3 h-3" /> : null}
            {isPositive ? "+" : ""}{diff}
          </span>
        )}
      </div>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-heading font-bold" style={{ color }}>{current}</span>
        {baseline !== null && (
          <span className="text-sm text-muted-foreground mb-1">
            from <span className="font-mono" style={{ color: getScoreColor(baseline), opacity: 0.7 }}>{baseline}</span>
          </span>
        )}
      </div>
      {/* Mini progress bar */}
      <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${getScoreGradient(current).join(", ")})` }}
          initial={{ width: 0 }}
          animate={{ width: `${current}%` }}
          transition={{ duration: 1.5, ease: "easeOut", delay: 0.3 }}
        />
      </div>
    </motion.div>
  );
}

// ============= Win Card =============

function WinCard({ win, index }: { win: any; index: number }) {
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
    ? new Date(win.firstMentionedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : win.detectedAt
    ? new Date(win.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
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
            <span className="text-xs font-bold uppercase" style={{ color: platformColor }}>{platformLabels[win.platform] || win.platform}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${platformColor}22`, color: platformColor }}>
              NEW MENTION
            </span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">{win.searchQuery}</p>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-xs text-muted-foreground">
              {win.previousValue} → <span className="text-emerald-300 font-medium">{win.currentValue}</span>
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

// ============= Wins Section =============

function WinsSection({ wins }: { wins: any[] }) {
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
          <WinCard key={`${win.queryLocationId}-${win.platform}`} win={win} index={i} />
        ))}
      </div>
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm font-medium hover:bg-emerald-500/20 transition-colors"
          >
            {showAll ? (
              <><ChevronUp className="w-4 h-4" /> Show Less</>
            ) : (
              <><ChevronDown className="w-4 h-4" /> See {wins.length - INITIAL_COUNT} More Wins</>
            )}
          </button>
        </div>
      )}
    </motion.section>
  );
}

// ============= Trend Chart =============

function VisibilityTrendChart({ trends }: { trends: any[] }) {
  if (!trends || trends.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Trend data will appear after the first rank check
      </div>
    );
  }

  const chartData = trends.map((t) => ({
    ...t,
    date: new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="gradOverall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradChatGPT" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradGemini" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradAI" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#e2e8f0",
          }}
        />
        <Area type="monotone" dataKey="overall" stroke="#22c55e" strokeWidth={2.5} fill="url(#gradOverall)" name="Overall" />
        <Area type="monotone" dataKey="chatgpt" stroke="#3b82f6" strokeWidth={1.5} fill="url(#gradChatGPT)" name="ChatGPT" />
        <Area type="monotone" dataKey="gemini" stroke="#a855f7" strokeWidth={1.5} fill="url(#gradGemini)" name="Gemini" />
        <Area type="monotone" dataKey="aiOverview" stroke="#f97316" strokeWidth={1.5} fill="url(#gradAI)" name="AI Overview" />
        <Legend
          wrapperStyle={{ fontSize: "11px", color: "#9ca3af" }}
          iconType="circle"
          iconSize={8}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ============= Platform Breakdown Radial =============

function PlatformBreakdown({ score }: { score: any }) {
  const data = [
    { name: "AI Overview", value: score.aiOverview, fill: "#f97316" },
    { name: "Gemini", value: score.gemini, fill: "#a855f7" },
    { name: "ChatGPT", value: score.chatgpt, fill: "#3b82f6" },
  ];

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={160} height={160}>
        <RadialBarChart cx="50%" cy="50%" innerRadius="30%" outerRadius="90%" data={data} startAngle={180} endAngle={0}>
          <RadialBar background={{ fill: "rgba(255,255,255,0.03)" }} dataKey="value" cornerRadius={4} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="space-y-3">
        {data.reverse().map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
            <span className="text-xs text-muted-foreground w-20">{d.name}</span>
            <span className="text-sm font-bold" style={{ color: d.fill }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============= Query Details Table =============

function QueryDetailsTable({ queries }: { queries: any[] }) {
  const [sortBy, setSortBy] = useState<"query" | "chatgpt" | "gemini" | "aiOverview">("query");

  const sorted = useMemo(() => {
    return [...queries].sort((a, b) => {
      if (sortBy === "query") return a.searchQuery.localeCompare(b.searchQuery);
      const aScore = (a[`${sortBy}Mentioned`] ? 1 : 0);
      const bScore = (b[`${sortBy}Mentioned`] ? 1 : 0);
      return bScore - aScore;
    });
  }, [queries, sortBy]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground" onClick={() => setSortBy("query")}>
              Search Query
            </th>
            <th className="text-center py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground" onClick={() => setSortBy("chatgpt")}>
              <span className="flex items-center justify-center gap-1"><Bot className="w-3 h-3" /> ChatGPT</span>
            </th>
            <th className="text-center py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground" onClick={() => setSortBy("gemini")}>
              <span className="flex items-center justify-center gap-1"><Sparkles className="w-3 h-3" /> Gemini</span>
            </th>
            <th className="text-center py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground" onClick={() => setSortBy("aiOverview")}>
              <span className="flex items-center justify-center gap-1"><Eye className="w-3 h-3" /> AI Overview</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((q, i) => (
            <motion.tr
              key={q.queryLocationId}
              className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.02 }}
            >
              <td className="py-3 px-3">
                <div className="font-medium text-foreground">{q.searchQuery}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{q.location}</div>
              </td>
              <td className="text-center py-3 px-2">
                <div className="flex flex-col items-center gap-1">
                  {q.chatgptMentioned ? (
                    <Eye className="w-4 h-4 text-green-400" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-gray-700" />
                  )}
                  {getChangeBadge(q.chatgptChange)}
                </div>
              </td>
              <td className="text-center py-3 px-2">
                <div className="flex flex-col items-center gap-1">
                  {q.geminiMentioned ? (
                    <Eye className="w-4 h-4 text-purple-400" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-gray-700" />
                  )}
                  {getChangeBadge(q.geminiChange)}
                </div>
              </td>
              <td className="text-center py-3 px-2">
                <div className="flex flex-col items-center gap-1">
                  {q.aiOverviewMentioned ? (
                    <Eye className="w-4 h-4 text-orange-400" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-gray-700" />
                  )}
                  {getChangeBadge(q.aiOverviewChange)}
                </div>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============= Bonus Wins Banner =============

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
      {/* Header */}
      <header className="border-b border-white/5 bg-gradient-to-r from-[#0a0f1e] via-[#0f172a] to-[#0a0f1e]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-5 h-5 text-blue-400" />
                <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">AI Visibility Report</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-heading font-bold text-white">
                {dashboard?.dashboardTitle || business?.name || "Visibility Dashboard"}
              </h1>
              {business?.website && (
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                  <ArrowUpRight className="w-3 h-3" />
                  {business.website}
                </p>
              )}
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground">Last updated</p>
              <p className="text-sm font-medium">
                {report.lastCheckAt ? new Date(report.lastCheckAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Pending"}
              </p>
            </div>
          </div>
        </div>
      </header>

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
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-white/[0.03] p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-white">{currentScore.mentionedQueries}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Queries Mentioned</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-white">{currentScore.totalQueries}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Tracked</p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Static Baseline — locked-in starting scores, never changes */}
        {baselineScore && (
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
              {report.baselineCheckAt && (
                <span className="text-xs text-muted-foreground">
                  Established {new Date(report.baselineCheckAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([
                { label: "Overall", value: baselineScore.overall, color: getScoreColor(baselineScore.overall) },
                { label: "ChatGPT", value: baselineScore.chatgpt, color: "#3b82f6" },
                { label: "Gemini", value: baselineScore.gemini, color: "#a855f7" },
                { label: "AI Overview", value: baselineScore.aiOverview, color: "#f97316" },
              ] as { label: string; value: number; color: string }[]).map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
                  <p className="text-2xl font-heading font-bold" style={{ color }}>{value}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">at start</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 opacity-60">
              These numbers reflect your AI visibility when we first started. They are locked and will never change.
            </p>
          </motion.section>
        )}

        {/* Before/After Comparison */}
        {baselineScore && (
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

        {/* Wins Section */}
        {report.recentWins.length > 0 && (
          <WinsSection wins={report.recentWins} />
        )}

        {/* Bonus Wins Banner */}
        <BonusWinsBanner bonusResults={bonusResults} />

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
        <footer className="text-center py-8 border-t border-white/5">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-heading font-bold text-blue-400">AI Answer Forge</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Powered by Rogue Business Marketing
          </p>
        </footer>
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
