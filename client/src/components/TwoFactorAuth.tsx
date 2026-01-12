import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Shield, ShieldCheck, ShieldOff, Copy, QrCode } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

type MFAFactor = {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at: string;
};

export default function TwoFactorAuth() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [mfaFactors, setMfaFactors] = useState<MFAFactor[]>([]);
  const [isEnrollDialogOpen, setIsEnrollDialogOpen] = useState(false);
  // Disable functionality removed - 2FA is permanent once enabled
  const [enrollStep, setEnrollStep] = useState<"qr" | "verify">("qr");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");

  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);


  // Check if 2FA is enabled
  const is2FAEnabled = mfaFactors.some(f => f.status === "verified");

  // Fetch MFA factors on mount
  useEffect(() => {
    fetchMFAFactors();
  }, []);

  const fetchMFAFactors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setMfaFactors(data?.totp || []);
    } catch (error: any) {
      console.error("Error fetching MFA factors:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEnrollment = async () => {
    setEnrolling(true);
    setEnrollStep("qr");
    setQrCode(null);
    setSecret(null);
    setFactorId(null);
    setVerifyCode("");

    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });

      if (error) throw error;

      if (data) {
        setQrCode(data.totp.qr_code);
        setSecret(data.totp.secret);
        setFactorId(data.id);
        setIsEnrollDialogOpen(true);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to start 2FA enrollment");
    } finally {
      setEnrolling(false);
    }
  };

  const handleVerifyEnrollment = async () => {
    if (!factorId || !verifyCode) {
      toast.error("Please enter the verification code");
      return;
    }

    setVerifying(true);
    try {
      // First, create a challenge
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeError) throw challengeError;

      // Then verify the challenge with the TOTP code
      const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: verifyCode,
      });

      if (verifyError) throw verifyError;

      toast.success("Two-factor authentication enabled successfully!");
      setIsEnrollDialogOpen(false);
      fetchMFAFactors();
    } catch (error: any) {
      toast.error(error.message || "Invalid verification code");
    } finally {
      setVerifying(false);
    }
  };

  // handleDisable2FA removed - 2FA cannot be disabled once enabled

  const copySecret = () => {
    if (secret) {
      navigator.clipboard.writeText(secret);
      toast.success("Secret key copied to clipboard");
    }
  };

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription>Add an extra layer of security to your account</CardDescription>
              </div>
            </div>
            {is2FAEnabled ? (
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-500" />
                <span className="text-sm text-green-500 font-medium">Enabled</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ShieldOff className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground font-medium">Disabled</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {is2FAEnabled ? (
            <>
              <p className="text-sm text-muted-foreground">
                Your account is protected with two-factor authentication. You'll need to enter a code from your authenticator app when signing in.
              </p>
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mt-2">
                <p className="text-sm text-green-500 font-medium flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  2FA is permanently enabled for maximum security
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Two-factor authentication cannot be disabled once enabled to protect your account.
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Two-factor authentication adds an extra layer of security by requiring a code from your authenticator app in addition to your password.
              </p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• Works with Google Authenticator, Authy, 1Password, and other TOTP apps</li>
                <li>• Required each time you sign in</li>
                <li>• Protects your account even if your password is compromised</li>
              </ul>
              <Button onClick={handleStartEnrollment} disabled={enrolling}>
                {enrolling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    Enable 2FA
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Enrollment Dialog */}
      <Dialog open={isEnrollDialogOpen} onOpenChange={setIsEnrollDialogOpen}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-card-foreground">Set Up Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Scan the QR code with your authenticator app, then enter the verification code.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {qrCode && (
              <div className="flex flex-col items-center space-y-4">
                <div className="bg-white p-4 rounded-lg">
                  <img src={qrCode} alt="2FA QR Code" className="w-48 h-48" />
                </div>
                
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Can't scan the QR code? Enter this key manually:
                  </p>
                  <div className="flex items-center gap-2 justify-center">
                    <code className="bg-muted px-3 py-1 rounded text-sm font-mono">
                      {secret}
                    </code>
                    <Button size="sm" variant="ghost" onClick={copySecret}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="verify-code">Verification Code</Label>
              <Input
                id="verify-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="Enter 6-digit code"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                className="bg-background border-input text-center text-2xl tracking-widest"
              />
              <p className="text-xs text-muted-foreground">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEnrollDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleVerifyEnrollment}
              disabled={verifying || verifyCode.length !== 6}
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Enable 2FA"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Dialog removed - 2FA is permanent */}
    </>
  );
}
