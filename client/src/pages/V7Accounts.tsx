import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Trash2, RefreshCw, Bot, Globe, Shield, AlertTriangle,
  CheckCircle2, Clock, Ban, Wifi, WifiOff
} from "lucide-react";

// ── Status badge helpers ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active:   { label: "Active",   color: "bg-green-500/15 text-green-400 border-green-500/30",  icon: <CheckCircle2 className="w-3 h-3" /> },
  warming:  { label: "Warming",  color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: <Clock className="w-3 h-3" /> },
  cooldown: { label: "Cooldown", color: "bg-blue-500/15 text-blue-400 border-blue-500/30",    icon: <RefreshCw className="w-3 h-3" /> },
  flagged:  { label: "Flagged",  color: "bg-red-500/15 text-red-400 border-red-500/30",       icon: <AlertTriangle className="w-3 h-3" /> },
  disabled: { label: "Disabled", color: "bg-gray-500/15 text-gray-400 border-gray-500/30",    icon: <Ban className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.disabled;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ── Add Account Modal ─────────────────────────────────────────────────────────

function AddAccountModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [provider, setProvider] = useState<"chatgpt" | "gemini">("chatgpt");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [proxyId, setProxyId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const { data: proxies } = trpc.v7Accounts.listProxies.useQuery();
  const addMutation = trpc.v7Accounts.addAccount.useMutation({
    onSuccess: () => { toast.success("Account added"); onSuccess(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!email || !password) { toast.error("Email and password are required"); return; }
    addMutation.mutate({
      provider,
      email,
      password,
      proxyId: proxyId ? parseInt(proxyId) : undefined,
      notes: notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Browser Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chatgpt">ChatGPT</SelectItem>
                <SelectItem value="gemini">Google / Gemini</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="account@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <p className="text-xs text-muted-foreground">Stored encrypted. Do not enable 2FA on these accounts.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Proxy (optional)</Label>
            <Select value={proxyId} onValueChange={setProxyId}>
              <SelectTrigger><SelectValue placeholder="No proxy assigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">No proxy</SelectItem>
                {(proxies ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.city}, {p.state} — {p.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Dedicated to Cole HVAC campaign" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={addMutation.isPending}>
            {addMutation.isPending ? "Adding..." : "Add Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Proxy Modal ───────────────────────────────────────────────────────────

function AddProxyModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [connectionString, setConnectionString] = useState("");

  const addMutation = trpc.v7Accounts.addProxy.useMutation({
    onSuccess: () => { toast.success("Proxy added"); onSuccess(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Residential Proxy</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Orlando" />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="FL" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Connection String</Label>
            <Input value={connectionString} onChange={(e) => setConnectionString(e.target.value)} placeholder="http://user:pass@host:port" />
            <p className="text-xs text-muted-foreground">Stored encrypted.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => addMutation.mutate({ connectionString, city: city || undefined, state: state || undefined })} disabled={addMutation.isPending}>
            {addMutation.isPending ? "Adding..." : "Add Proxy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function V7Accounts() {
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddProxy, setShowAddProxy] = useState(false);

  const { data: accounts, refetch: refetchAccounts, isLoading: loadingAccounts } = trpc.v7Accounts.listAccounts.useQuery();
  const { data: proxies, refetch: refetchProxies } = trpc.v7Accounts.listProxies.useQuery();
  const { data: sessionLogs } = trpc.v7Accounts.listSessionLogs.useQuery({ limit: 20 });

  const updateStatusMutation = trpc.v7Accounts.updateAccountStatus.useMutation({
    onSuccess: () => refetchAccounts(),
    onError: (e) => toast.error(e.message),
  });
  const deleteAccountMutation = trpc.v7Accounts.deleteAccount.useMutation({
    onSuccess: () => { toast.success("Account removed"); refetchAccounts(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteProxyMutation = trpc.v7Accounts.deleteProxy.useMutation({
    onSuccess: () => { toast.success("Proxy removed"); refetchProxies(); },
    onError: (e) => toast.error(e.message),
  });

  const chatgptAccounts = (accounts ?? []).filter((a: any) => a.provider === "chatgpt");
  const geminiAccounts = (accounts ?? []).filter((a: any) => a.provider === "gemini");

  const activeCount = (accounts ?? []).filter((a: any) => a.status === "active").length;
  const flaggedCount = (accounts ?? []).filter((a: any) => a.status === "flagged").length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">V7 Browser Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage ChatGPT and Gemini accounts used for V7 browser-based AI training sessions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAddProxy(true)}>
            <Globe className="w-4 h-4 mr-2" />Add Proxy
          </Button>
          <Button size="sm" onClick={() => setShowAddAccount(true)}>
            <Plus className="w-4 h-4 mr-2" />Add Account
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Accounts", value: (accounts ?? []).length, icon: <Bot className="w-5 h-5 text-primary" /> },
          { label: "Active", value: activeCount, icon: <CheckCircle2 className="w-5 h-5 text-green-400" /> },
          { label: "Flagged", value: flaggedCount, icon: <AlertTriangle className="w-5 h-5 text-red-400" /> },
          { label: "Proxies", value: (proxies ?? []).length, icon: <Globe className="w-5 h-5 text-blue-400" /> },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CloakBrowser notice */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
        <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-yellow-300">CloakBrowser Pro License Required</p>
          <p className="text-xs text-muted-foreground mt-1">
            V7 training sessions use CloakBrowser Pro to launch real browser instances for each account.
            Add your license key in <strong>CTR Module → Settings → CloakBrowser</strong> to activate live sessions.
            Until then, V7 runs in simulation mode (debate logic executes but no real browser is launched).
          </p>
        </div>
      </div>

      {/* ChatGPT Accounts */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="w-4 h-4" /> ChatGPT Accounts
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{chatgptAccounts.length} account{chatgptAccounts.length !== 1 ? "s" : ""}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingAccounts ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : chatgptAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No ChatGPT accounts yet</p>
              <p className="text-xs mt-1">Add accounts to enable V7 ChatGPT training sessions</p>
            </div>
          ) : (
            <div className="space-y-2">
              {chatgptAccounts.map((account: any) => (
                <div key={account.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={account.status} />
                    <div>
                      <p className="text-sm font-medium">{account.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {account.totalSessionsRun ?? 0} sessions · {account.consecutiveErrors ?? 0} consecutive errors
                        {account.lastUsedAt ? ` · Last used ${new Date(account.lastUsedAt).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={account.status}
                      onValueChange={(v) => updateStatusMutation.mutate({ id: account.id, status: v as any })}
                    >
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                          <SelectItem key={val} value={val}>{cfg.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm("Remove this account?")) deleteAccountMutation.mutate({ id: account.id }); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gemini Accounts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" /> Google / Gemini Accounts
          </CardTitle>
          <CardDescription className="text-xs">{geminiAccounts.length} account{geminiAccounts.length !== 1 ? "s" : ""} — also used for AI Overview training</CardDescription>
        </CardHeader>
        <CardContent>
          {geminiAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No Google/Gemini accounts yet</p>
              <p className="text-xs mt-1">Add Google accounts to enable Gemini and AI Overview training</p>
            </div>
          ) : (
            <div className="space-y-2">
              {geminiAccounts.map((account: any) => (
                <div key={account.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={account.status} />
                    <div>
                      <p className="text-sm font-medium">{account.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {account.totalSessionsRun ?? 0} sessions · {account.consecutiveErrors ?? 0} consecutive errors
                        {account.lastUsedAt ? ` · Last used ${new Date(account.lastUsedAt).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={account.status}
                      onValueChange={(v) => updateStatusMutation.mutate({ id: account.id, status: v as any })}
                    >
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                          <SelectItem key={val} value={val}>{cfg.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm("Remove this account?")) deleteAccountMutation.mutate({ id: account.id }); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Proxies */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" /> Residential Proxies
          </CardTitle>
          <CardDescription className="text-xs">{(proxies ?? []).length} proxy{(proxies ?? []).length !== 1 ? "ies" : ""} configured</CardDescription>
        </CardHeader>
        <CardContent>
          {(proxies ?? []).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No proxies configured</p>
              <p className="text-xs mt-1">Add residential proxies to route training sessions through local IPs</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(proxies ?? []).map((proxy: any) => (
                <div key={proxy.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                  <div className="flex items-center gap-3">
                    {proxy.status === 'active' ? <Wifi className="w-4 h-4 text-green-400" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />}
                    <div>
                      <p className="text-sm font-medium">{proxy.city ?? 'Unknown'}, {proxy.state ?? ''}</p>
                      <p className="text-xs text-muted-foreground capitalize">{proxy.status} · {proxy.country ?? 'US'}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => { if (confirm("Remove this proxy?")) deleteProxyMutation.mutate({ id: proxy.id }); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Session Logs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Session Logs</CardTitle>
          <CardDescription className="text-xs">Last 20 V7 browser training sessions</CardDescription>
        </CardHeader>
        <CardContent>
          {(sessionLogs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No sessions run yet</p>
          ) : (
            <div className="space-y-1.5">
              {(sessionLogs ?? []).map((log: any) => (
                <div key={log.id} className="flex items-center justify-between text-xs p-2 rounded border border-border/50">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${log.success ? "bg-green-400" : "bg-red-400"}`} />
                    <span className="font-medium">{log.provider}</span>
                    <span className="text-muted-foreground truncate max-w-[200px]">{log.query}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      <AddAccountModal open={showAddAccount} onClose={() => setShowAddAccount(false)} onSuccess={refetchAccounts} />
      <AddProxyModal open={showAddProxy} onClose={() => setShowAddProxy(false)} onSuccess={refetchProxies} />
    </div>
  );
}
