/**
 * AuditHistory.tsx
 *
 * Displays all completed AI Visibility Audits.
 * Features:
 *  - List of all audits with scores and metadata
 *  - "Open" button to view the full report in a new window
 *  - "Share" button to generate/copy a shareable URL
 *  - "Delete" button to remove an audit
 *  - Quota meter showing used/total audits for the current billing period
 *    (anniversary-based: runs from signup day-of-month to same day next month)
 *  - Super admins see "Unlimited" instead of a quota meter
 *  - "Buy More Audits" modal with Stripe Checkout (agency users only)
 *  - Low-quota warning toast (shown when ≤ 2 remaining)
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ExternalLink,
  Share2,
  Check,
  Copy,
  ShoppingCart,
  Loader2,
  BarChart3,
  Clock,
  MapPin,
  Globe,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Infinity as InfinityIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Overage packages (must match stripeAuditOverage.ts) ─────────────────────

const OVERAGE_PACKAGES = [
  { id: "audit_5"  as const, audits: 5,  price: 15,  label: "5 Audits",  perAudit: "$3.00/audit" },
  { id: "audit_10" as const, audits: 10, price: 25,  label: "10 Audits", perAudit: "$2.50/audit" },
  { id: "audit_25" as const, audits: 25, price: 60,  label: "25 Audits", perAudit: "$2.40/audit" },
  { id: "audit_50" as const, audits: 50, price: 100, label: "50 Audits", perAudit: "$2.00/audit" },
];

// ─── Score colour helper ──────────────────────────────────────────────────────

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 60) return "text-green-400";
  if (score >= 30) return "text-amber-400";
  return "text-red-400";
}

// ─── Format date helper ───────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Quota Meter ─────────────────────────────────────────────────────────────

function QuotaMeter({
  used,
  total,
  remaining,
  isAdmin,
  periodStart,
  periodEnd,
  onBuyMore,
}: {
  used: number;
  total: number | null;
  remaining: number | null;
  isAdmin: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  onBuyMore: () => void;
}) {
  if (isAdmin) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <InfinityIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Audit Usage</span>
          <span className="text-xs text-muted-foreground">— Super Admin: Unlimited</span>
        </div>
        <span className="text-sm font-bold text-primary">{used} run this period</span>
      </div>
    );
  }

  const safeTotal = total ?? 20;
  const safeRemaining = remaining ?? 0;
  const pct = safeTotal > 0 ? Math.min(100, Math.round((used / safeTotal) * 100)) : 0;
  const low = safeRemaining <= 2;

  return (
    <div className={cn(
      "rounded-lg border p-4 flex flex-col gap-3",
      low ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/20"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {low && <AlertTriangle className="h-4 w-4 text-amber-400" />}
          <span className="text-sm font-medium">Audit Usage</span>
          {periodStart && periodEnd && (
            <span className="text-xs text-muted-foreground">
              {fmtDate(periodStart)} – {fmtDate(periodEnd)}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={onBuyMore} className="h-7 text-xs gap-1">
          <ShoppingCart className="h-3 w-3" />
          Buy More
        </Button>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              low ? "bg-amber-500" : pct >= 80 ? "bg-orange-500" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{used} used</span>
          <span className={low ? "text-amber-400 font-medium" : ""}>
            {safeRemaining} remaining of {safeTotal}
          </span>
        </div>
      </div>

      {low && (
        <p className="text-xs text-amber-300">
          You have {safeRemaining} audit{safeRemaining !== 1 ? "s" : ""} left this period.
          Purchase more to keep running audits.
        </p>
      )}
    </div>
  );
}

// ─── Buy More Modal ───────────────────────────────────────────────────────────

function BuyMoreModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<typeof OVERAGE_PACKAGES[number]["id"] | null>(null);
  const [loading, setLoading] = useState(false);

  const checkoutMutation = trpc.prospectAudit.createOverageCheckout.useMutation({
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (err) => { toast.error(err.message); setLoading(false); },
  });

  const handlePurchase = () => {
    if (!selected) return;
    setLoading(true);
    const origin = window.location.origin;
    checkoutMutation.mutate({
      packageId: selected,
      successUrl: `${origin}/audit-overage-success`,
      cancelUrl: `${origin}/audit-history`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Buy More Audits
          </DialogTitle>
          <DialogDescription>
            Purchase additional AI Visibility Audits. Credits are added immediately after payment.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          {OVERAGE_PACKAGES.map((pkg) => {
            const isSel = selected === pkg.id;
            const isBest = pkg.id === "audit_25";
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setSelected(pkg.id)}
                className={cn(
                  "relative text-left rounded-lg border p-4 transition-all",
                  isSel
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                {isBest && (
                  <span className="absolute -top-2 left-3 text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                    BEST VALUE
                  </span>
                )}
                <p className="font-bold text-lg">{pkg.label}</p>
                <p className="text-2xl font-bold text-primary mt-1">${pkg.price}</p>
                <p className="text-xs text-muted-foreground mt-1">{pkg.perAudit}</p>
                {isSel && (
                  <div className="absolute top-3 right-3 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2">
          <Button className="flex-1" disabled={!selected || loading} onClick={handlePurchase}>
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirecting to Stripe…</>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4 mr-2" />
                Purchase{selected ? ` — $${OVERAGE_PACKAGES.find(p => p.id === selected)?.price}` : ""}
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Share Button ─────────────────────────────────────────────────────────────

function ShareButton({ auditId }: { auditId: number }) {
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const shareMutation = trpc.prospectAudit.getShareLink.useMutation({
    onSuccess: (data) => {
      const fullUrl = `${window.location.origin}${data.url}`;
      navigator.clipboard.writeText(fullUrl).then(() => {
        setCopied(true);
        toast.success("Share link copied to clipboard");
        setTimeout(() => setCopied(false), 3000);
      });
      setGenerating(false);
    },
    onError: (err) => { toast.error(err.message); setGenerating(false); },
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => { setGenerating(true); shareMutation.mutate({ auditId }); }}
      disabled={generating}
      className="h-8 gap-1.5 text-xs"
    >
      {generating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : copied ? (
        <Check className="h-3.5 w-3.5 text-green-400" />
      ) : (
        <Share2 className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied!" : "Share"}
    </Button>
  );
}

// ─── Delete Button ────────────────────────────────────────────────────────────

function DeleteButton({ auditId, businessName, onDeleted }: { auditId: number; businessName: string; onDeleted: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = trpc.prospectAudit.deleteAudit.useMutation({
    onSuccess: () => {
      toast.success(`Audit for "${businessName}" deleted`);
      onDeleted();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirmOpen(true)}
        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
        title="Delete audit"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this audit?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the AI Visibility Audit for <strong>{businessName}</strong>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteMutation.mutate({ auditId })}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Audit Row ────────────────────────────────────────────────────────────────

function AuditRow({ audit, onDeleted }: { audit: any; onDeleted: () => void }) {
  const handleOpen = () => {
    window.open(`/prospect-audit?auditId=${audit.id}`, "_blank", "noopener");
  };

  const date = audit.completedAt
    ? fmtDate(audit.completedAt)
    : fmtDate(audit.createdAt);

  const statusColors: Record<string, string> = {
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    running:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pending:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
    failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      {/* Business info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold truncate">{audit.businessName}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px] px-1.5 py-0", statusColors[audit.status] ?? "")}
          >
            {audit.status}
          </Badge>
          {audit.campaignId && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">
              Linked to Campaign
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          {audit.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {audit.location}
            </span>
          )}
          {audit.website && (
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              {audit.normalizedDomain || audit.website}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {date}
          </span>
        </div>
      </div>

      {/* Scores */}
      {audit.status === "completed" && (
        <div className="flex items-center gap-4 text-center shrink-0">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Overall</p>
            <p className={cn("text-lg font-bold", scoreColor(audit.overallScore))}>{audit.overallScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">ChatGPT</p>
            <p className={cn("text-lg font-bold", scoreColor(audit.chatgptScore))}>{audit.chatgptScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Gemini</p>
            <p className={cn("text-lg font-bold", scoreColor(audit.geminiScore))}>{audit.geminiScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">AI Ov.</p>
            <p className={cn("text-lg font-bold", scoreColor(audit.aiOverviewScore))}>{audit.aiOverviewScore ?? "—"}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {audit.status === "completed" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={handleOpen}
              className="h-8 gap-1.5 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </Button>
            <ShareButton auditId={audit.id} />
          </>
        )}
        {audit.status === "running" && (
          <span className="flex items-center gap-1 text-xs text-blue-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running…
          </span>
        )}
        {/* Delete button — always visible */}
        <DeleteButton
          auditId={audit.id}
          businessName={audit.businessName}
          onDeleted={onDeleted}
        />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AuditHistory() {
  const [buyMoreOpen, setBuyMoreOpen] = useState(false);
  const [lowQuotaToasted, setLowQuotaToasted] = useState(false);

  const { data: audits = [], isLoading, refetch } = trpc.prospectAudit.listAudits.useQuery(
    { limit: 50 },
    { refetchInterval: 10_000 }
  );

  const { data: quota } = trpc.prospectAudit.getQuota.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Low-quota warning toast — fires once per session when ≤ 2 remaining (agency users only)
  useEffect(() => {
    if (quota && !quota.isAdmin && quota.remaining != null && quota.remaining <= 2 && !lowQuotaToasted) {
      setLowQuotaToasted(true);
      toast.warning(
        `You have ${quota.remaining} audit${quota.remaining !== 1 ? "s" : ""} remaining this period.`,
        {
          description: "Purchase more to keep running AI Visibility Audits.",
          action: {
            label: "Buy More",
            onClick: () => setBuyMoreOpen(true),
          },
          duration: 8000,
        }
      );
    }
  }, [quota, lowQuotaToasted]);

  const handleNewAudit = () => {
    window.open("/prospect-audit", "_blank", "noopener");
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            AI Visibility Audits
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View completed audits, share reports with prospects, and manage your audit credits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={handleNewAudit} className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" />
            New Audit
          </Button>
        </div>
      </div>

      {/* Quota meter */}
      {quota !== undefined && quota !== null && (
        <QuotaMeter
          used={quota.used}
          total={quota.total ?? null}
          remaining={quota.remaining ?? null}
          isAdmin={quota.isAdmin ?? false}
          periodStart={quota.periodStart ?? null}
          periodEnd={quota.periodEnd ?? null}
          onBuyMore={() => setBuyMoreOpen(true)}
        />
      )}

      {/* Audit list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : audits.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No audits yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Run your first AI Visibility Audit to see results here.
          </p>
          <Button className="mt-4" onClick={handleNewAudit}>
            Run First Audit
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {(audits as any[]).map((audit) => (
            <AuditRow key={audit.id} audit={audit} onDeleted={() => refetch()} />
          ))}
        </div>
      )}

      {/* Buy More Modal (agency users only) */}
      {quota && !quota.isAdmin && (
        <BuyMoreModal open={buyMoreOpen} onClose={() => setBuyMoreOpen(false)} />
      )}
    </div>
  );
}
