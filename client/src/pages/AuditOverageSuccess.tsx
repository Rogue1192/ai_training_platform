/**
 * AuditOverageSuccess.tsx
 *
 * Landing page after a successful Stripe Checkout for audit overage blocks.
 * Reads the session_id from the URL, calls fulfillOverage to credit the audits,
 * then redirects to the Audit History page.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

function useSearchParams() {
  return [new URLSearchParams(window.location.search)] as const;
}

function useNavigate() {
  const [, setLocation] = useLocation();
  return setLocation;
}

export default function AuditOverageSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get("session_id");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [auditsGranted, setAuditsGranted] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const fulfillMutation = trpc.prospectAudit.fulfillOverage.useMutation({
    onSuccess: (data) => {
      setAuditsGranted(data.auditsGranted);
      setStatus("success");
      // Auto-redirect after 3 seconds
      setTimeout(() => navigate("/audit-history"), 3000);
    },
    onError: (err) => {
      setErrorMsg(err.message);
      setStatus("error");
    },
  });

  useEffect(() => {
    if (!sessionId) {
      setErrorMsg("No session ID found in URL.");
      setStatus("error");
      return;
    }
    fulfillMutation.mutate({ sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        {status === "loading" && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h2 className="text-xl font-semibold">Confirming your purchase…</h2>
            <p className="text-muted-foreground text-sm">
              Please wait while we verify your payment and credit your audits.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 className="h-14 w-14 text-green-400 mx-auto" />
            <h2 className="text-2xl font-bold">Payment Confirmed!</h2>
            <p className="text-muted-foreground">
              <span className="text-white font-semibold">{auditsGranted} audits</span> have been
              added to your account. You'll be redirected to your audit history in a moment.
            </p>
            <Button onClick={() => navigate("/audit-history")} className="w-full">
              Go to Audit History
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            <p className="text-muted-foreground text-sm">{errorMsg}</p>
            <p className="text-xs text-muted-foreground">
              If you were charged, please contact support and reference your Stripe session ID:
              <br />
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{sessionId}</code>
            </p>
            <Button variant="outline" onClick={() => navigate("/audit-history")} className="w-full">
              Return to Audit History
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
