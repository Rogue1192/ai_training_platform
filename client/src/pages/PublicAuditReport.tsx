/**
 * PublicAuditReport.tsx
 *
 * A publicly accessible, read-only view of a completed AI Visibility Audit.
 * Accessed via /audit/:token — no login required.
 *
 * Flow:
 *   - leadCaptured = false → render full report BLURRED with a hard-gate lead
 *     capture lightbox on top. No way to dismiss without submitting.
 *   - leadCaptured = true  → render full clean report with CTA buttons.
 *
 * CTA buttons open a calendar lightbox using the agency's embed code (or the
 * global super-admin embed code as a fallback).
 */

import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  AlertCircle,
  TrendingUp,
  Calendar,
  Zap,
  X,
  User,
  Phone,
  Mail,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
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
  const [revenueView, setRevenueView] = useState<"monthly" | "annual">("monthly");
  const closeRate = parseFloat(closeRateInput) || 0;
  const liveRevenueMonthly =
    closeRate > 0
      ? Math.round(lostOpportunities * (captureRate / 100) * (closeRate / 100) * avgJobValue)
      : null;
  const liveRevenueAnnual = liveRevenueMonthly !== null ? liveRevenueMonthly * 12 : null;
  const liveRevenueGap = revenueView === "monthly" ? liveRevenueMonthly : liveRevenueAnnual;

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

        {/* Monthly / Annual toggle */}
        <div className="flex items-center justify-center gap-1 mb-4">
          <button
            onClick={() => setRevenueView("monthly")}
            className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
              revenueView === "monthly"
                ? "bg-green-500/20 text-green-400 border border-green-500/40"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setRevenueView("annual")}
            className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
              revenueView === "annual"
                ? "bg-green-500/20 text-green-400 border border-green-500/40"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            Annual
          </button>
        </div>

        <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-3">
          Estimated {revenueView === "monthly" ? "Monthly" : "Annual"} Revenue Opportunity
        </p>
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
              {revenueView === "monthly"
                ? `${lostOpportunities.toLocaleString()} missed searches × ${captureRate}% capture × ${closeRate}% close × $${avgJobValue.toLocaleString()} avg job`
                : `${lostOpportunities.toLocaleString()} missed searches × ${captureRate}% capture × ${closeRate}% close × $${avgJobValue.toLocaleString()} avg job × 12 months`
              }
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

// ─── Lead Capture Lightbox ────────────────────────────────────────────────────

function LeadCaptureOverlay({
  token,
  onCaptured,
}: {
  token: string;
  onCaptured: () => void;
}) {
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLead = trpc.prospectAudit.submitLead.useMutation();

  const isValid =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.phone.trim().length >= 7 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError(null);
    try {
      await submitLead.mutateAsync({ token, ...form });
      setSubmitted(true);
      setTimeout(() => onCaptured(), 1200);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    }
  };

  return (
    /* Full-screen overlay — cannot be dismissed */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        className="w-full max-w-md bg-[#0d1225] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {submitted ? (
          <div className="p-10 text-center space-y-4">
            <CheckCircle2 className="w-14 h-14 text-green-400 mx-auto" />
            <h2 className="text-xl font-bold text-white">Report Unlocked!</h2>
            <p className="text-sm text-gray-400">Loading your full report…</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-b border-white/5 px-8 pt-8 pb-6 text-center">
              <div className="inline-flex items-center gap-2 mb-3">
                <Zap className="w-5 h-5 text-blue-400" />
                <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">
                  Your Report Is Ready
                </span>
              </div>
              <h2 className="text-2xl font-bold text-white leading-tight">
                Where should we send<br />your AI Visibility Report?
              </h2>
              <p className="text-sm text-gray-400 mt-2">
                Enter your info below and we'll text you the report link.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
                    <input
                      type="text"
                      value={form.firstName}
                      onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                      placeholder="Jane"
                      required
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/60 transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Last Name <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
                    <input
                      type="text"
                      value={form.lastName}
                      onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                      placeholder="Smith"
                      required
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/60 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Mobile Phone <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="(555) 867-5309"
                    required
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/60 transition-all"
                  />
                </div>
                <p className="text-[10px] text-gray-700 mt-1">We'll text you the report link — no spam, ever.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Email Address <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="jane@example.com"
                    required
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/60 transition-all"
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitLead.isPending || !isValid}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors mt-1"
              >
                {submitLead.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Unlocking Report…
                  </>
                ) : (
                  <>
                    View My AI Visibility Report
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ─── Calendar Lightbox ────────────────────────────────────────────────────────

function CalendarLightbox({
  embedCode,
  onClose,
}: {
  embedCode: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="w-full max-w-2xl bg-[#0d1225] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-white">Schedule a Strategy Call</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div
          className="p-4 min-h-[500px]"
          dangerouslySetInnerHTML={{ __html: embedCode }}
        />
      </motion.div>
    </div>
  );
}

// ─── CTA Bar ─────────────────────────────────────────────────────────────────

function CTABar({ calendarEmbedCode }: { calendarEmbedCode: string | null }) {
  const [showCalendar, setShowCalendar] = useState(false);

  return (
    <>
      <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-r from-blue-600/10 to-purple-600/10 p-6 sm:p-8 text-center space-y-4">
        <div className="inline-flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5 text-blue-400" />
          <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">
            Ready to Improve Your AI Visibility?
          </span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-white">
          Get More AI Visibility — Start Showing Up Where It Counts
        </h2>
        <p className="text-sm text-gray-400 max-w-lg mx-auto">
          Your report shows exactly where you're being left out of AI search results. Let's build a plan to fix it.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          {calendarEmbedCode ? (
            <button
              onClick={() => setShowCalendar(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
            >
              <Calendar className="w-4 h-4" />
              Schedule a Free Strategy Call
            </button>
          ) : (
            <span className="text-sm text-gray-600 italic">Contact us to learn more</span>
          )}
        </div>
      </div>

      {/* Mid-report CTA (smaller, inline) */}
      {calendarEmbedCode && (
        <div className="flex justify-center">
          <button
            onClick={() => setShowCalendar(true)}
            className="flex items-center gap-2 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            <Calendar className="w-4 h-4" />
            Get More AI Visibility — Book a Call
          </button>
        </div>
      )}

      <AnimatePresence>
        {showCalendar && calendarEmbedCode && (
          <CalendarLightbox
            embedCode={calendarEmbedCode}
            onClose={() => setShowCalendar(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PublicAuditReport() {
  const { token } = useParams<{ token: string }>();
  const [leadCapturedLocally, setLeadCapturedLocally] = useState(false);

  const { data: audit, isLoading, error } = trpc.prospectAudit.getByShareToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  const { data: meta, refetch: refetchMeta } = trpc.prospectAudit.getPublicAuditMeta.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  // MUST be called unconditionally before any early returns (React rules of hooks)
  const { isAuthenticated } = useAuth({ redirectOnUnauthenticated: false });

  const handleLeadCaptured = () => {
    setLeadCapturedLocally(true);
    refetchMeta();
  };

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

  const avgJobValue = (audit as any).avgJobValue as number | null;

  // Lead gate logic:
  // - 'internal' (Visibility Audit): never gated — always show full report
  // - 'widget' (Lead Gen): gated until leadCaptured=true (fires once at widget submission)
  // - Authenticated users: always see full report regardless of source
  const auditSource = meta?.source ?? 'internal';
  const isLeadCaptured = isAuthenticated || auditSource === 'internal' || leadCapturedLocally || (meta?.leadCaptured ?? false);
  const calendarEmbedCode = meta?.calendarEmbedCode ?? null;

  // The report content (always rendered; blurred when not captured)
  const reportContent = (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
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

      {/* First CTA — appears right after the hero numbers */}
      {isLeadCaptured && <CTABar calendarEmbedCode={calendarEmbedCode} />}

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
        score={baselineScores}
        establishedAt={audit.completedAt}
      />

      {/* Query details table */}
      <QueryDetailsTable queries={queryDetails} />

      {/* Bottom CTA */}
      {isLeadCaptured && <CTABar calendarEmbedCode={calendarEmbedCode} />}

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
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative">
      {/* Report — blurred until lead captured */}
      <div
        className={isLeadCaptured ? "" : "select-none pointer-events-none"}
        style={isLeadCaptured ? {} : { filter: "blur(6px)", userSelect: "none" }}
      >
        {reportContent}
      </div>

      {/* Lead capture overlay — hard gate, no dismiss */}
      <AnimatePresence>
        {!isLeadCaptured && token && (
          <LeadCaptureOverlay
            token={token}
            onCaptured={handleLeadCaptured}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
