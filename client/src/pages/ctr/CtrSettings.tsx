import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Settings,
  Shield,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Bot,
  Globe,
  Key,
  Cpu,
  RefreshCw,
  Wifi,
  WifiOff,
  User,
  Monitor,
  Chrome,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type Platform = "chatgpt" | "google" | "proxy";

const PLATFORM_LABELS: Record<Platform, string> = {
  chatgpt: "ChatGPT",
  google: "Google / Gemini",
  proxy: "Proxy",
};

const PLATFORM_ICONS: Record<Platform, React.ElementType> = {
  chatgpt: Bot,
  google: Globe,
  proxy: Wifi,
};

const PLATFORM_COLORS: Record<Platform, string> = {
  chatgpt: "bg-green-500/15 text-green-400 border-green-500/30",
  google: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  proxy: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-muted text-muted-foreground",
  active: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  in_use: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
};

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu",
];

// ── Add Credential Modal ─────────────────────────────────────────────────────

function AddCredentialModal({
  open,
  onClose,
  onSaved,
  defaultPlatform,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultPlatform?: Platform;
}) {
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<Platform>(defaultPlatform ?? "chatgpt");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [showPass, setShowPass] = useState(false);

  const save = trpc.ctrSettings.saveCredential.useMutation({
    onSuccess: () => { toast.success("Credential saved"); onSaved(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  function handleSave() {
    if (!label.trim()) { toast.error("Label is required"); return; }
    save.mutate({ label, platform, email, password, proxyUrl, notes });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Credential</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Label <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. ChatGPT Account #1" value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Select value={platform} onValueChange={v => setPlatform(v as Platform)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chatgpt">ChatGPT</SelectItem>
                <SelectItem value="google">Google / Gemini</SelectItem>
                <SelectItem value="proxy">Proxy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {platform !== "proxy" ? (
            <>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="account@email.com" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <div className="relative">
                  <Input
                    type={showPass ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label>Proxy URL</Label>
              <Input placeholder="http://user:pass@host:port" value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground">Format: http://user:pass@host:port or socks5://...</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs font-normal">Optional</span></Label>
            <Input placeholder="e.g. US residential proxy, Chicago area" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending} className="flex-1">
              {save.isPending ? "Saving..." : "Save Credential"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Profile Modal ────────────────────────────────────────────────────────

function AddProfileModal({
  open,
  onClose,
  onSaved,
  pool,
  credentials,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  pool: "ai" | "ctr";
  credentials: any[];
}) {
  const [name, setName] = useState("");
  const [cloakProfileId, setCloakProfileId] = useState("");
  const [proxyCredId, setProxyCredId] = useState<string>("");
  const [chatgptCredId, setChatgptCredId] = useState<string>("");
  const [googleCredId, setGoogleCredId] = useState<string>("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [notes, setNotes] = useState("");

  const proxies = credentials.filter(c => c.platform === "proxy");
  const chatgptAccounts = credentials.filter(c => c.platform === "chatgpt");
  const googleAccounts = credentials.filter(c => c.platform === "google");

  const save = trpc.ctrSettings.saveProfile.useMutation({
    onSuccess: () => { toast.success("Profile saved"); onSaved(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  function handleSave() {
    if (!name.trim()) { toast.error("Profile name is required"); return; }
    save.mutate({
      pool,
      name,
      cloakProfileId: cloakProfileId || undefined,
      proxyCredentialId: proxyCredId ? parseInt(proxyCredId) : undefined,
      chatgptCredentialId: chatgptCredId ? parseInt(chatgptCredId) : undefined,
      googleCredentialId: googleCredId ? parseInt(googleCredId) : undefined,
      timezone,
      notes,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add {pool === "ai" ? "AI Training" : "CTR"} Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Profile Name <span className="text-destructive">*</span></Label>
            <Input placeholder={pool === "ai" ? "e.g. AI Trainer #1" : "e.g. CTR Profile #1"} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>CloakBrowser Profile ID <span className="text-muted-foreground text-xs font-normal">Optional</span></Label>
            <Input placeholder="UUID from CloakBrowser Manager" value={cloakProfileId} onChange={e => setCloakProfileId(e.target.value)} />
            <p className="text-xs text-muted-foreground">Leave blank to auto-generate a new fingerprint seed</p>
          </div>
          <div className="space-y-1.5">
            <Label>Proxy</Label>
            <Select value={proxyCredId} onValueChange={setProxyCredId}>
              <SelectTrigger><SelectValue placeholder="Select a proxy..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">No proxy</SelectItem>
                {proxies.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {pool === "ai" && (
            <div className="space-y-1.5">
              <Label>ChatGPT Account</Label>
              <Select value={chatgptCredId} onValueChange={setChatgptCredId}>
                <SelectTrigger><SelectValue placeholder="Select ChatGPT account..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {chatgptAccounts.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Google / Gemini Account</Label>
            <Select value={googleCredId} onValueChange={setGoogleCredId}>
              <SelectTrigger><SelectValue placeholder="Select Google account..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {googleAccounts.map(g => <SelectItem key={g.id} value={String(g.id)}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs font-normal">Optional</span></Label>
            <Input placeholder="Any notes about this profile..." value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending} className="flex-1">
              {save.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Profile Card ─────────────────────────────────────────────────────────────

function ProfileCard({ profile, pool, credentials, onDeleted }: { profile: any; pool: "ai" | "ctr"; credentials: any[]; onDeleted: () => void }) {
  const deleteProfile = trpc.ctrSettings.deleteProfile.useMutation({
    onSuccess: () => { toast.success("Profile deleted"); onDeleted(); },
    onError: (e) => toast.error(e.message),
  });

  const chatgptCred = credentials.find(c => c.id === profile.chatgptCredentialId);
  const googleCred = credentials.find(c => c.id === profile.googleCredentialId);
  const proxyCred = credentials.find(c => c.id === profile.proxyCredentialId);

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Monitor className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">{profile.name}</p>
                <Badge className={cn("text-xs", STATUS_COLORS[profile.status] ?? STATUS_COLORS.idle)}>
                  {profile.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {chatgptCred && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Bot className="h-3 w-3" /> {chatgptCred.label}
                  </span>
                )}
                {googleCred && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Globe className="h-3 w-3" /> {googleCred.label}
                  </span>
                )}
                {proxyCred && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Wifi className="h-3 w-3" /> {proxyCred.label}
                  </span>
                )}
                {!chatgptCred && !googleCred && !proxyCred && (
                  <span className="text-xs text-muted-foreground">No credentials assigned</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-muted-foreground">{profile.timezone}</span>
                <span className="text-xs text-muted-foreground">{profile.sessionCount} sessions</span>
                {pool === "ctr" && profile.searchHistoryAgeDays > 0 && (
                  <span className="text-xs text-green-400">{profile.searchHistoryAgeDays}d history</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => deleteProfile.mutate({ pool, id: profile.id })}
            className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Settings Page ───────────────────────────────────────────────────────

export default function CtrSettings() {
  const [addCredOpen, setAddCredOpen] = useState(false);
  const [addCredPlatform, setAddCredPlatform] = useState<Platform>("chatgpt");
  const [addAiProfileOpen, setAddAiProfileOpen] = useState(false);
  const [addCtrProfileOpen, setAddCtrProfileOpen] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"untested" | "ok" | "error">("untested");

  // CloakBrowser config state
  const [licenseKey, setLicenseKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(5);
  const [humanize, setHumanize] = useState(true);
  const [headless, setHeadless] = useState(false);
  const [geoip, setGeoip] = useState(true);

  const { data: config } = trpc.ctrSettings.getConfig.useQuery(undefined, {
    onSuccess: (d: any) => {
      if (d) {
        setLicenseKey(d.licenseKey ?? "");
        setMaxConcurrent(d.maxConcurrent ?? 5);
        setHumanize(d.humanize ?? true);
        setHeadless(d.headless ?? false);
        setGeoip(d.geoip ?? true);
      }
    },
  });

  const saveConfig = trpc.ctrSettings.saveConfig.useMutation({
    onSuccess: () => toast.success("CloakBrowser config saved"),
    onError: (e: any) => toast.error(e.message),
  });

  const { data: credentials = [], refetch: refetchCreds } = trpc.ctrSettings.listCredentials.useQuery();
  const { data: aiProfiles = [], refetch: refetchAi } = trpc.ctrSettings.listProfiles.useQuery({ pool: "ai" });
  const { data: ctrProfiles = [], refetch: refetchCtr } = trpc.ctrSettings.listProfiles.useQuery({ pool: "ctr" });

  const deleteCredential = trpc.ctrSettings.deleteCredential.useMutation({
    onSuccess: () => { toast.success("Credential deleted"); refetchCreds(); },
    onError: (e: any) => toast.error(e.message),
  });

  const testConnection = trpc.ctrSettings.testCloakConnection.useMutation({
    onSuccess: (result: any) => {
      setConnectionStatus(result.ok ? "ok" : "error");
      toast[result.ok ? "success" : "error"](result.ok ? "CloakBrowser Pro connected" : result.message);
      setTestingConnection(false);
    },
    onError: (e: any) => {
      setConnectionStatus("error");
      toast.error(e.message);
      setTestingConnection(false);
    },
  });

  function handleTestConnection() {
    setTestingConnection(true);
    testConnection.mutate({ licenseKey });
  }

  const chatgptCreds = (credentials as any[]).filter(c => c.platform === "chatgpt");
  const googleCreds = (credentials as any[]).filter(c => c.platform === "google");
  const proxyCreds = (credentials as any[]).filter(c => c.platform === "proxy");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure CloakBrowser Pro, browser profiles, and credential vault
        </p>
      </div>

      <Tabs defaultValue="cloak">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cloak" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" /> CloakBrowser
          </TabsTrigger>
          <TabsTrigger value="ai-profiles" className="gap-1.5">
            <Bot className="h-3.5 w-3.5" /> AI Training
          </TabsTrigger>
          <TabsTrigger value="ctr-profiles" className="gap-1.5">
            <Chrome className="h-3.5 w-3.5" /> CTR Profiles
          </TabsTrigger>
          <TabsTrigger value="credentials" className="gap-1.5">
            <Key className="h-3.5 w-3.5" /> Credentials
          </TabsTrigger>
        </TabsList>

        {/* ── CloakBrowser Pro ─────────────────────────────────────────── */}
        <TabsContent value="cloak" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                CloakBrowser Pro License
              </CardTitle>
              <CardDescription>
                71 source-level C++ patches. reCAPTCHA v3 score 0.9. Passes Cloudflare Turnstile.
                <a href="https://cloakbrowser.dev/" target="_blank" rel="noreferrer" className="text-primary ml-1 hover:underline">
                  Get a key →
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>License Key</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      placeholder="cb_xxxxxxxxxxxxxxxx"
                      value={licenseKey}
                      onChange={e => setLicenseKey(e.target.value)}
                      className="pr-10 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testingConnection || !licenseKey}
                    className="gap-1.5 shrink-0"
                  >
                    {testingConnection ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : connectionStatus === "ok" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : connectionStatus === "error" ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Wifi className="h-4 w-4" />
                    )}
                    {testingConnection ? "Testing..." : "Test"}
                  </Button>
                </div>
                {connectionStatus === "ok" && (
                  <p className="text-xs text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Connected — CloakBrowser Pro active
                  </p>
                )}
                {connectionStatus === "error" && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <XCircle className="h-3 w-3" /> Connection failed — check your license key
                  </p>
                )}
              </div>

              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Max Concurrent Sessions</p>
                    <p className="text-xs text-muted-foreground">$49 plan = 20 sessions · $199 plan = 200 sessions</p>
                  </div>
                  <span className="text-primary font-semibold text-sm">{maxConcurrent}</span>
                </div>
                <Slider
                  min={1}
                  max={20}
                  step={1}
                  value={[maxConcurrent]}
                  onValueChange={([v]) => setMaxConcurrent(v)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>20 (current plan)</span>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t">
                <p className="text-sm font-medium">Default Launch Config</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">Humanize</p>
                      <p className="text-xs text-muted-foreground">Human-like mouse curves, keyboard timing, scroll patterns</p>
                    </div>
                    <Switch checked={humanize} onCheckedChange={setHumanize} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">GeoIP Auto-Detect</p>
                      <p className="text-xs text-muted-foreground">Auto-match timezone and locale to proxy IP</p>
                    </div>
                    <Switch checked={geoip} onCheckedChange={setGeoip} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">Headless Mode</p>
                      <p className="text-xs text-muted-foreground">Keep OFF for GBP CTR and AI training — some sites detect headless</p>
                    </div>
                    <Switch checked={headless} onCheckedChange={setHeadless} />
                  </div>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => saveConfig.mutate({ licenseKey, maxConcurrent, humanize, headless, geoip })}
                disabled={saveConfig.isPending}
              >
                {saveConfig.isPending ? "Saving..." : "Save CloakBrowser Config"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AI Training Profiles ──────────────────────────────────────── */}
        <TabsContent value="ai-profiles" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium">AI Training Profile Pool</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Profiles used exclusively for AI Answer Forge — ChatGPT, Gemini, Perplexity, AI Overviews
              </p>
            </div>
            <Button onClick={() => setAddAiProfileOpen(true)} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Profile
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold">{(aiProfiles as any[]).length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total Profiles</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold text-green-400">
                  {(aiProfiles as any[]).filter(p => p.status === "idle").length}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Available</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold text-amber-400">
                  {(aiProfiles as any[]).filter(p => p.status === "in_use").length}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">In Use</p>
              </div>
            </div>

            {(aiProfiles as any[]).length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Bot className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No AI training profiles yet</p>
                <p className="text-xs text-muted-foreground mt-1">Add profiles and assign ChatGPT + Google accounts to them</p>
                <Button onClick={() => setAddAiProfileOpen(true)} size="sm" className="mt-3 gap-1.5">
                  <Plus className="h-4 w-4" /> Add First Profile
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {(aiProfiles as any[]).map(p => (
                  <ProfileCard key={p.id} profile={p} pool="ai" credentials={credentials as any[]} onDeleted={refetchAi} />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── CTR Profiles ─────────────────────────────────────────────── */}
        <TabsContent value="ctr-profiles" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium">CTR Profile Pool</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Profiles used exclusively for GBP CTR campaigns and drive simulations
              </p>
            </div>
            <Button onClick={() => setAddCtrProfileOpen(true)} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Profile
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold">{(ctrProfiles as any[]).length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total Profiles</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold text-green-400">
                  {(ctrProfiles as any[]).filter(p => p.status === "idle").length}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Available</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold text-amber-400">
                  {(ctrProfiles as any[]).filter(p => p.status === "in_use").length}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">In Use</p>
              </div>
            </div>

            {(ctrProfiles as any[]).length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Chrome className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No CTR profiles yet</p>
                <p className="text-xs text-muted-foreground mt-1">Add profiles and assign Google accounts and proxies</p>
                <Button onClick={() => setAddCtrProfileOpen(true)} size="sm" className="mt-3 gap-1.5">
                  <Plus className="h-4 w-4" /> Add First Profile
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {(ctrProfiles as any[]).map(p => (
                  <ProfileCard key={p.id} profile={p} pool="ctr" credentials={credentials as any[]} onDeleted={refetchCtr} />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Credentials Vault ─────────────────────────────────────────── */}
        <TabsContent value="credentials" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium">Credentials Vault</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Passwords encrypted at rest. Assign accounts to profiles in the AI Training and CTR tabs.
              </p>
            </div>
            <Button onClick={() => { setAddCredPlatform("chatgpt"); setAddCredOpen(true); }} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Credential
            </Button>
          </div>

          {/* ChatGPT */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Bot className="h-4 w-4 text-green-400" /> ChatGPT Accounts
                <Badge variant="outline" className="text-xs">{chatgptCreds.length}</Badge>
              </h3>
              <Button variant="ghost" size="sm" onClick={() => { setAddCredPlatform("chatgpt"); setAddCredOpen(true); }} className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {chatgptCreds.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-xs text-muted-foreground">No ChatGPT accounts added yet</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {chatgptCreds.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Bot className="h-3.5 w-3.5 text-green-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.label}</p>
                        {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                      </div>
                    </div>
                    <button onClick={() => deleteCredential.mutate({ id: c.id })} className="text-muted-foreground hover:text-destructive ml-3 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Google / Gemini */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-400" /> Google / Gemini Accounts
                <Badge variant="outline" className="text-xs">{googleCreds.length}</Badge>
              </h3>
              <Button variant="ghost" size="sm" onClick={() => { setAddCredPlatform("google"); setAddCredOpen(true); }} className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {googleCreds.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-xs text-muted-foreground">No Google accounts added yet</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {googleCreds.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.label}</p>
                        {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                      </div>
                    </div>
                    <button onClick={() => deleteCredential.mutate({ id: c.id })} className="text-muted-foreground hover:text-destructive ml-3 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Proxies */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Wifi className="h-4 w-4 text-orange-400" /> Proxies
                <Badge variant="outline" className="text-xs">{proxyCreds.length}</Badge>
              </h3>
              <Button variant="ghost" size="sm" onClick={() => { setAddCredPlatform("proxy"); setAddCredOpen(true); }} className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {proxyCreds.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-xs text-muted-foreground">No proxies added yet — use residential proxies for best results</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {proxyCreds.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wifi className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.label}</p>
                        {c.notes && <p className="text-xs text-muted-foreground truncate">{c.notes}</p>}
                      </div>
                    </div>
                    <button onClick={() => deleteCredential.mutate({ id: c.id })} className="text-muted-foreground hover:text-destructive ml-3 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <AddCredentialModal
        open={addCredOpen}
        onClose={() => setAddCredOpen(false)}
        onSaved={refetchCreds}
        defaultPlatform={addCredPlatform}
      />
      <AddProfileModal
        open={addAiProfileOpen}
        onClose={() => setAddAiProfileOpen(false)}
        onSaved={refetchAi}
        pool="ai"
        credentials={credentials as any[]}
      />
      <AddProfileModal
        open={addCtrProfileOpen}
        onClose={() => setAddCtrProfileOpen(false)}
        onSaved={refetchCtr}
        pool="ctr"
        credentials={credentials as any[]}
      />
    </div>
  );
}
