/**
 * ProspectAudit — Internal Prospect Visibility Audit Tool
 *
 * Opens in a clean new window (no platform chrome). 3-step flow:
 *   Step 1: Business info form
 *   Step 2: Review / edit AI-generated queries
 *   Step 3: Live progress + results (identical layout to ClientDashboard)
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import {
  Zap,
  Building2,
  MapPin,
  Globe,
  Tag,
  ChevronRight,
  Pencil,
  Trash2,
  Plus,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Target,
  Bot,
  Sparkles,
  Eye,
  Award,
} from "lucide-react";
import {
  VisibilityGauge,
  PlatformBreakdown,
  ScoreComparisonCard,
  BaselineScoreCards,
  QueryDetailsTable,
  ReportHeader,
  ReportFooter,
} from "@/components/VisibilityReportComponents";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueryItem {
  searchQuery: string;
  location: string;
}

type Step = "form" | "queries" | "running" | "results";

// ─── Step 1: Business Info Form ───────────────────────────────────────────────

function BusinessInfoForm({
  onGenerate,
}: {
  onGenerate: (data: {
    businessName: string;
    website: string;
    location: string;
    industry: string;
    seedKeywords: string;
  }) => void;
}) {
  const [form, setForm] = useState({
    businessName: "",
    website: "",
    location: "",
    industry: "",
    seedKeywords: "",
  });
  const [isGenerating, setIsGenerating] = useState(false);

  const generateMutation = trpc.prospectAudit.generateQueries.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessName.trim() || !form.location.trim()) return;
    setIsGenerating(true);
    try {
      await onGenerate(form);
    } finally {
      setIsGenerating(false);
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder: string,
    icon: React.ElementType,
    required = false,
    hint?: string
  ) => {
    const Icon = icon;
    return (
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
        <div className="relative">
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            required={required}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500/60 focus:bg-white/[0.06] transition-all"
          />
        </div>
        {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-xl"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Logo / Title */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <Zap className="w-6 h-6 text-blue-400" />
            <span className="text-sm font-bold text-blue-400 uppercase tracking-widest">
              AI Visibility Audit
            </span>
          </div>
          <h1 className="text-3xl font-heading font-bold text-white">
            AI Visibility Audit
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            Enter the business info below to run an AI visibility audit.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 space-y-5"
        >
          {field("businessName", "Business Name", "e.g. Titan Cleaning Company", Building2, true)}
          {field("location", "Primary Location", "e.g. Fredericksburg, VA", MapPin, true, "City and state where the business primarily operates")}
          {field("website", "Website", "e.g. https://titancleaningco.com", Globe, false)}
          {field("industry", "Industry", "e.g. Residential Cleaning, HVAC, Plumbing", Tag, false)}
          {field(
            "seedKeywords",
            "Seed Keywords",
            "e.g. house cleaning, maid service, deep clean",
            Tag,
            false,
            "Comma-separated keywords — the AI will use these to generate 15 targeted queries"
          )}

          <button
            type="submit"
            disabled={isGenerating || !form.businessName.trim() || !form.location.trim()}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors mt-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating Queries…
              </>
            ) : (
              <>
                Generate Queries
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Step 2: Query Review & Edit ──────────────────────────────────────────────

function QueryReviewStep({
  queries,
  businessName,
  onRun,
  onBack,
}: {
  queries: QueryItem[];
  businessName: string;
  onRun: (queries: QueryItem[]) => void;
  onBack: () => void;
}) {
  const [items, setItems] = useState<QueryItem[]>(queries);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newQuery, setNewQuery] = useState("");

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditValue(items[idx].searchQuery);
  };

  const saveEdit = (idx: number) => {
    if (!editValue.trim()) return;
    setItems((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, searchQuery: editValue.trim() } : q))
    );
    setEditingIdx(null);
  };

  const remove = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addQuery = () => {
    if (!newQuery.trim()) return;
    const location = items[0]?.location ?? "";
    setItems((prev) => [...prev, { searchQuery: newQuery.trim(), location }]);
    setNewQuery("");
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] p-6">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-blue-400" />
              <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">
                AI Visibility Audit
              </span>
            </div>
          <h1 className="text-2xl font-heading font-bold text-white">
            AI Visibility Audit — {businessName}
          </h1>
            <p className="text-sm text-gray-500 mt-1">
              {items.length} queries generated. Edit, remove, or add before running.
            </p>
          </div>

          {/* Query list */}
          <div className="space-y-2 mb-6">
            {items.map((q, idx) => (
              <motion.div
                key={idx}
                className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.02 }}
              >
                <span className="text-xs font-mono text-gray-600 w-5 shrink-0">
                  {idx + 1}
                </span>
                {editingIdx === idx ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => saveEdit(idx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(idx);
                      if (e.key === "Escape") setEditingIdx(null);
                    }}
                    className="flex-1 bg-white/[0.06] border border-blue-500/40 rounded-lg px-3 py-1.5 text-sm text-gray-100 focus:outline-none"
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">{q.searchQuery}</p>
                    <p className="text-[10px] text-gray-600">{q.location}</p>
                  </div>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(idx)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(idx)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Add query row */}
          {items.length < 20 && (
            <div className="flex gap-2 mb-8">
              <input
                type="text"
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuery()}
                placeholder="Add a query…"
                className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500/60 transition-all"
              />
              <button
                onClick={addQuery}
                disabled={!newQuery.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-gray-300 hover:bg-white/[0.08] disabled:opacity-40 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={onBack}
              className="px-5 py-3 rounded-xl border border-white/10 text-sm text-gray-400 hover:bg-white/[0.04] transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => onRun(items)}
              disabled={items.length === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              <Play className="w-4 h-4" />
              Run Visibility Audit ({items.length} queries)
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Step 3a: Running Progress ────────────────────────────────────────────────

function RunningStep({
  total,
  completed,
  latestQuery,
}: {
  total: number;
  completed: number;
  latestQuery: string;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-md text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-8">
          <div className="relative w-32 h-32 mx-auto mb-6">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
              <circle
                cx="64" cy="64" r="56"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="8"
              />
              <motion.circle
                cx="64" cy="64" r="56"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 56}
                strokeDashoffset={2 * Math.PI * 56 * (1 - pct / 100)}
                initial={{ strokeDashoffset: 2 * Math.PI * 56 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - pct / 100) }}
                transition={{ duration: 0.5 }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-heading font-bold text-white">{pct}%</span>
            </div>
          </div>

          <h2 className="text-xl font-heading font-bold text-white mb-2">
            Running AI Visibility Audit
          </h2>
          <p className="text-sm text-gray-500">
            {completed} of {total} queries checked
          </p>
        </div>

        <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">
            Currently checking
          </p>
          <p className="text-sm text-gray-300 font-medium">{latestQuery || "Initializing…"}</p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <Bot className="w-3 h-3 text-blue-400" /> ChatGPT
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-purple-400" /> Gemini
          </span>
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3 text-orange-400" /> AI Overview
          </span>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Step 3b: Results ─────────────────────────────────────────────────────────

function ResultsStep({
  businessName,
  website,
  scores,
  snapshots,
  completedAt,
}: {
  businessName: string;
  website?: string | null;
  scores: {
    overall: number;
    chatgpt: number;
    gemini: number;
    aiOverview: number;
    queriesMentioned: number;
    totalQueries: number;
  };
  snapshots: any[];
  completedAt: Date;
}) {
  // Shape snapshots into the format QueryDetailsTable expects
  const queryDetails = snapshots.map((s) => ({
    queryLocationId: s.searchQuery,
    searchQuery: s.searchQuery,
    location: s.location,
    chatgptMentioned: s.chatgptMentioned,
    geminiMentioned: s.geminiMentioned,
    aiOverviewMentioned: s.aiOverviewMentioned,
    // On a baseline run there is no previous check, so all changes are "never"
    chatgptChange: s.chatgptMentioned ? "new" : "never",
    geminiChange: s.geminiMentioned ? "new" : "never",
    aiOverviewChange: s.aiOverviewMentioned ? "new" : "never",
  }));

  const baselineScore = {
    overall: scores.overall,
    chatgpt: scores.chatgpt,
    gemini: scores.gemini,
    aiOverview: scores.aiOverview,
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-gray-100">
      <ReportHeader
        title={businessName}
        website={website}
        lastUpdated={completedAt}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Hero: Overall Score */}
        <motion.section
          className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent p-6 sm:p-10"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="flex flex-col items-center md:items-start">
              <VisibilityGauge score={scores.overall} size={220} />
              <div className="mt-4 text-center md:text-left">
                <h2 className="text-lg font-heading font-bold text-white">
                  Overall AI Visibility
                </h2>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
                Platform Breakdown
              </h3>
              <PlatformBreakdown score={scores} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-white/[0.03] p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-white">
                    {scores.queriesMentioned}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Queries Mentioned
                  </p>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-white">
                    {scores.totalQueries}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Total Tracked
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Starting Baseline — same locked-in cards as the weekly report */}
        <BaselineScoreCards score={baselineScore} establishedAt={completedAt} />

        {/* Before/After — on a baseline run current === baseline so deltas are 0 */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <h2 className="text-lg font-heading font-bold text-white mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-yellow-400" />
            Platform Scores
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ScoreComparisonCard
              title="Overall"
              current={scores.overall}
              baseline={null}
              icon={Target}
            />
            <ScoreComparisonCard
              title="ChatGPT"
              current={scores.chatgpt}
              baseline={null}
              icon={Bot}
              platformColor="#3b82f6"
            />
            <ScoreComparisonCard
              title="Gemini"
              current={scores.gemini}
              baseline={null}
              icon={Sparkles}
              platformColor="#a855f7"
            />
            <ScoreComparisonCard
              title="AI Overview"
              current={scores.aiOverview}
              baseline={null}
              icon={Eye}
              platformColor="#f97316"
            />
          </div>
        </motion.section>

        {/* Query-by-Query Breakdown */}
        <motion.section
          className="rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <h2 className="text-lg font-heading font-bold text-white mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-400" />
            Query-by-Query Breakdown
          </h2>
          <QueryDetailsTable queries={queryDetails} />
        </motion.section>

        <ReportFooter />
      </main>
    </div>
  );
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export default function ProspectAudit() {
  const [step, setStep] = useState<Step>("form");
  const [formData, setFormData] = useState<{
    businessName: string;
    website: string;
    location: string;
    industry: string;
    seedKeywords: string;
  } | null>(null);
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [auditId, setAuditId] = useState<number | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, latest: "" });
  const [results, setResults] = useState<{
    scores: any;
    snapshots: any[];
    completedAt: Date;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateMutation = trpc.prospectAudit.generateQueries.useMutation();
  const createAuditMutation = trpc.prospectAudit.createAudit.useMutation();
  const runAuditMutation = trpc.prospectAudit.runAudit.useMutation();

  // Step 1 → Step 2: Generate queries
  const handleGenerate = async (data: typeof formData) => {
    if (!data) return;
    setFormData(data);
    setError(null);
    try {
      const res = await generateMutation.mutateAsync({
        businessName: data.businessName,
        location: data.location,
        industry: data.industry || undefined,
        seedKeywords: data.seedKeywords || undefined,
      });
      setQueries(res.queries as QueryItem[]);
      setStep("queries");
    } catch (e: any) {
      setError(e.message || "Failed to generate queries");
    }
  };

  // Step 2 → Step 3: Create audit record then run it
  const handleRun = async (confirmedQueries: QueryItem[]) => {
    if (!formData) return;
    setError(null);
    setStep("running");
    setProgress({ completed: 0, total: confirmedQueries.length, latest: "" });

    try {
      // Create the audit record
      const { auditId: id } = await createAuditMutation.mutateAsync({
        businessName: formData.businessName,
        website: formData.website || undefined,
        location: formData.location,
        industry: formData.industry || undefined,
        seedKeywords: formData.seedKeywords || undefined,
        queries: confirmedQueries,
      });
      setAuditId(id);

      // Simulate progress updates while the audit runs
      // (the mutation is synchronous from the client's perspective but takes ~30-90s)
      let fakeProgress = 0;
      const progressInterval = setInterval(() => {
        fakeProgress = Math.min(fakeProgress + 1, confirmedQueries.length - 1);
        setProgress((p) => ({
          ...p,
          completed: fakeProgress,
          latest: confirmedQueries[fakeProgress]?.searchQuery ?? "",
        }));
      }, (60_000 / confirmedQueries.length)); // spread evenly over ~60s estimate

      const { snapshots, scores } = await runAuditMutation.mutateAsync({ auditId: id });

      clearInterval(progressInterval);
      setProgress({ completed: confirmedQueries.length, total: confirmedQueries.length, latest: "" });

      setResults({ scores, snapshots, completedAt: new Date() });
      setStep("results");
    } catch (e: any) {
      setError(e.message || "Audit failed");
      setStep("queries"); // send back to edit step on error
    }
  };

  return (
    <div className="font-sans">
      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-red-900/80 border border-red-500/40 text-red-200 text-sm px-4 py-3 rounded-xl shadow-xl"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </motion.div>
        )}

        {step === "form" && (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <BusinessInfoForm onGenerate={handleGenerate} />
          </motion.div>
        )}

        {step === "queries" && (
          <motion.div key="queries" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <QueryReviewStep
              queries={queries}
              businessName={formData?.businessName ?? ""}
              onRun={handleRun}
              onBack={() => setStep("form")}
            />
          </motion.div>
        )}

        {step === "running" && (
          <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <RunningStep
              total={progress.total}
              completed={progress.completed}
              latestQuery={progress.latest}
            />
          </motion.div>
        )}

        {step === "results" && results && (
          <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ResultsStep
              businessName={formData?.businessName ?? ""}
              website={formData?.website}
              scores={results.scores}
              snapshots={results.snapshots}
              completedAt={results.completedAt}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
