import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Check, X, Key, PlayCircle, AlertCircle, Database, Mail, Search, Link2, Eye, EyeOff } from "lucide-react";
import TwoFactorAuth from "@/components/TwoFactorAuth";

type AIProvider = "openai" | "anthropic" | "google" | "minimax";
type ServiceType = "dataforseo" | "monkeyindexer" | "resend" | "stripe";

const PROVIDERS: {
  id: AIProvider;
  label: string;
  description: string;
  placeholder: string;
}[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4.1, GPT-4.1-mini, GPT-4o, o3, o3-mini, GPT-3.5-turbo",
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5",
    placeholder: "sk-ant-...",
  },
  {
    id: "google",
    label: "Google AI",
    description: "Gemini 2.5 Flash, Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash",
    placeholder: "AIza...",
  },
  {
    id: "minimax",
    label: "MiniMax",
    description: "MiniMax-M2.7, MiniMax-M2.7-highspeed, MiniMax-M2.5 — used as the influencer model",
    placeholder: "eyJ...",
  },
];

const SERVICE_CONFIGS: {
  id: ServiceType;
  label: string;
  description: string;
  icon: React.ReactNode;
  fields: { key: string; label: string; placeholder: string; type?: string }[];
}[] = [
  {
    id: "dataforseo",
    label: "DataForSEO",
    description: "Keyword research, AI search volume, and LLM mention tracking",
    icon: <Search className="w-6 h-6 text-primary" />,
    fields: [
      { key: "login", label: "Login (Email)", placeholder: "your@email.com" },
      { key: "password", label: "Password", placeholder: "••••••••", type: "password" },
    ],
  },
  {
    id: "monkeyindexer",
    label: "Monkey Indexer",
    description: "Fast Google indexing for published content pages — monkeyindexer.com",
    icon: <Database className="w-6 h-6 text-primary" />,
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "mi_...", type: "password" },
    ],
  },
  {
    id: "resend",
    label: "Resend",
    description: "Branded email delivery for client notifications",
    icon: <Mail className="w-6 h-6 text-primary" />,
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "re_...", type: "password" },
    ],
  },
  {
    id: "stripe",
    label: "Stripe",
    description: "Agency billing — charges agencies when clients are added",
    icon: <Key className="w-6 h-6 text-primary" />,
    fields: [
      { key: "liveKey", label: "Live Secret Key", placeholder: "sk_live_...", type: "password" },
      { key: "testKey", label: "Test Secret Key", placeholder: "sk_test_...", type: "password" },
    ],
  },
];

// ─── AI Models Section ────────────────────────────────────────────────────────
const TRAINER_MODELS = [
  { value: "MiniMax-M2.7", label: "MiniMax M2.7 (default)" },
  { value: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 High Speed" },
  { value: "MiniMax-M2.5", label: "MiniMax M2.5" },
  { value: "MiniMax-Text-01", label: "MiniMax Text-01 (legacy)" },
];

const CONTENT_MODELS = [
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 (default)" },
  { value: "claude-haiku-4-5-20250929", label: "Claude Haiku 4.5 (faster)" },
  { value: "claude-opus-4-5-20250929", label: "Claude Opus 4.5 (best quality)" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini (cheaper)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

function AIModelsSection() {
  const { data: config, refetch: refetchConfig } = trpc.modelConfig.get.useQuery();
  const saveConfig = trpc.modelConfig.save.useMutation();
  const resumeMutation = trpc.modelConfig.resumeDeprecatedCampaigns.useMutation();
  const { data: deprecatedCampaigns } = trpc.modelConfig.getDeprecatedCampaigns.useQuery();

  const [trainerModel, setTrainerModel] = useState("");
  const [contentModel, setContentModel] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync dropdowns when config loads
  React.useEffect(() => {
    if (config) {
      setTrainerModel(config.trainerModel || "MiniMax-M2.7");
      setContentModel(config.contentModel || "claude-sonnet-4-5-20250929");
    }
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig.mutateAsync({ trainerModel, contentModel });
      await refetchConfig();
      toast.success("Model configuration saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save model config");
    } finally {
      setSaving(false);
    }
  };

  const handleResume = async () => {
    try {
      const result = await resumeMutation.mutateAsync();
      toast.success(`Resumed ${result.resumed} campaign(s)`);
    } catch (err: any) {
      toast.error(err.message || "Failed to resume campaigns");
    }
  };

  const deprecatedCount = deprecatedCampaigns?.length ?? 0;

  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground mb-1">AI Models</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Configure which AI models are used for training and content generation.
        If a model is deprecated by its provider, affected campaigns will be paused automatically and shown here.
      </p>

      {deprecatedCount > 0 && (
        <div className="mb-4 p-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-300">
              {deprecatedCount} campaign{deprecatedCount > 1 ? "s" : ""} paused due to deprecated model
            </p>
            <p className="text-xs text-yellow-400/80 mt-1">
              Update the model below, then click Resume to restart affected campaigns.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-yellow-500 text-yellow-300 hover:bg-yellow-500/20 shrink-0"
            onClick={handleResume}
            disabled={resumeMutation.isPending}
          >
            {resumeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Resume Campaigns"}
          </Button>
        </div>
      )}

      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Database className="w-6 h-6 text-primary" />
            <div>
              <CardTitle className="text-base">Model Selection</CardTitle>
              <CardDescription>MiniMax trains the AI; content generation uses Anthropic or OpenAI</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium">MiniMax Trainer Model</Label>
            <p className="text-xs text-muted-foreground">Used to generate all training conversation turns. Low token cost, high volume.</p>
            <select
              value={trainerModel}
              onChange={(e) => setTrainerModel(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {TRAINER_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
              {trainerModel && !TRAINER_MODELS.find(m => m.value === trainerModel) && (
                <option value={trainerModel}>{trainerModel} (custom)</option>
              )}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Content Generation Model</Label>
            <p className="text-xs text-muted-foreground">Used to write credibility pages, FAQs, and schema markup.</p>
            <select
              value={contentModel}
              onChange={(e) => setContentModel(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {CONTENT_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
              {contentModel && !CONTENT_MODELS.find(m => m.value === contentModel) && (
                <option value={contentModel}>{contentModel} (custom)</option>
              )}
            </select>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save Model Configuration"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const { data: apiKeys, isLoading, refetch } = trpc.apiKey.list.useQuery();
  const { data: serviceKeys, refetch: refetchServiceKeys } = trpc.serviceKey.list.useQuery();
  const createApiKey = trpc.apiKey.create.useMutation();
  const updateApiKey = trpc.apiKey.update.useMutation();
  const deleteApiKey = trpc.apiKey.delete.useMutation();
  const testApiKey = trpc.apiKey.test.useMutation();

  const saveServiceKey = trpc.serviceKey.save.useMutation();
  const deleteServiceKeyMutation = trpc.serviceKey.delete.useMutation();
  const testServiceKeyMutation = trpc.serviceKey.test.useMutation();

  const [keyInputs, setKeyInputs] = useState<Record<AIProvider, string>>({
    openai: "",
    anthropic: "",
    google: "",
    minimax: "",
  });

  const [serviceInputs, setServiceInputs] = useState<Record<ServiceType, Record<string, string>>>({
    dataforseo: { login: "", password: "" },
    monkeyindexer: { apiKey: "" },
    resend: { apiKey: "" },
    stripe: { liveKey: "", testKey: "" },
  });

  const [testingProvider, setTestingProvider] = useState<AIProvider | null>(null);
  const [testingService, setTestingService] = useState<ServiceType | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string; model?: string; responseTime?: number } | null>
  >({});

  // Credibility Webhook — URL and signing secret stored inside the whitelabel service key JSON
  const whitelabelKey = serviceKeys?.find((k) => k.service === "whitelabel");
  const savedWebhookUrl: string = (whitelabelKey?.metadata as any)?.credibilityWebhookUrl || "";
  const savedWebhookSecret: string = (whitelabelKey?.metadata as any)?.credibilityWebhookSecret || "";
  const savedInboundSecret: string = (whitelabelKey?.metadata as any)?.inboundWebhookSecret || "";
  const [webhookUrlInput, setWebhookUrlInput] = useState("");
  const [webhookSecretInput, setWebhookSecretInput] = useState("");
  const [inboundSecretInput, setInboundSecretInput] = useState("");
  const [showInboundSecret, setShowInboundSecret] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);

  const handleSaveWebhookUrl = async () => {
    const url = webhookUrlInput.trim();
    if (!url) { toast.error("Please enter a webhook URL"); return; }
    if (!url.startsWith("http")) { toast.error("URL must start with http:// or https://"); return; }
    setSavingWebhook(true);
    try {
      const existing = (whitelabelKey?.metadata as Record<string, string>) || {};
      const merged = { ...existing, credibilityWebhookUrl: url };
      await saveServiceKey.mutateAsync({ service: "whitelabel", value: JSON.stringify(merged) });
      await refetchServiceKeys();
      setWebhookUrlInput("");
      toast.success("Credibility webhook URL saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save webhook URL");
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleSaveWebhookSecret = async () => {
    const secret = webhookSecretInput.trim();
    if (!secret) { toast.error("Please enter a webhook secret"); return; }
    try {
      const existing = (whitelabelKey?.metadata as Record<string, string>) || {};
      const merged = { ...existing, credibilityWebhookSecret: secret };
      await saveServiceKey.mutateAsync({ service: "whitelabel", value: JSON.stringify(merged) });
      await refetchServiceKeys();
      setWebhookSecretInput("");
      toast.success("Webhook signing secret saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save webhook secret");
    }
  };

  const handleSaveInboundSecret = async () => {
    const secret = inboundSecretInput.trim();
    if (!secret) { toast.error("Please enter an inbound webhook secret"); return; }
    try {
      const existing = (whitelabelKey?.metadata as Record<string, string>) || {};
      const merged = { ...existing, inboundWebhookSecret: secret };
      await saveServiceKey.mutateAsync({ service: "whitelabel", value: JSON.stringify(merged) });
      await refetchServiceKeys();
      setInboundSecretInput("");
      toast.success("Inbound webhook secret saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save inbound webhook secret");
    }
  };

  const handleClearWebhookUrl = async () => {
    try {
      const existing = (whitelabelKey?.metadata as Record<string, string>) || {};
      const { credibilityWebhookUrl: _removed, ...rest } = existing;
      if (Object.keys(rest).length === 0) {
        await deleteServiceKeyMutation.mutateAsync({ service: "whitelabel" });
      } else {
        await saveServiceKey.mutateAsync({ service: "whitelabel", value: JSON.stringify(rest) });
      }
      await refetchServiceKeys();
      toast.success("Webhook URL removed");
    } catch (err: any) {
      toast.error(err.message || "Failed to remove webhook URL");
    }
  };

  const getKeyStatus = (provider: AIProvider) => {
    return apiKeys?.find((k) => k.provider === provider);
  };

  const getServiceStatus = (service: ServiceType) => {
    return serviceKeys?.find((k) => k.service === service);
  };

  const handleSaveKey = async (provider: AIProvider, key: string) => {
    if (!key.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    const existing = getKeyStatus(provider);
    try {
      if (existing) {
        await updateApiKey.mutateAsync({ provider, apiKey: key });
        toast.success(`${provider.toUpperCase()} API key updated successfully`);
      } else {
        await createApiKey.mutateAsync({ provider, apiKey: key });
        toast.success(`${provider.toUpperCase()} API key added successfully`);
      }
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
      setTestResults((prev) => ({ ...prev, [provider]: null }));
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to save API key");
    }
  };

  const handleDeleteKey = async (provider: AIProvider) => {
    try {
      await deleteApiKey.mutateAsync({ provider });
      toast.success(`${provider.toUpperCase()} API key deleted`);
      setTestResults((prev) => ({ ...prev, [provider]: null }));
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete API key");
    }
  };

  const handleTestKey = async (provider: AIProvider) => {
    setTestingProvider(provider);
    setTestResults((prev) => ({ ...prev, [provider]: null }));
    try {
      const result = await testApiKey.mutateAsync({ provider });
      setTestResults((prev) => ({ ...prev, [provider]: result }));
      if (result.success) {
        toast.success(`${provider.toUpperCase()} API key is working! Response time: ${result.responseTime}ms`);
      } else {
        toast.error(`${provider.toUpperCase()} test failed: ${result.message}`);
      }
      refetch();
    } catch (error: any) {
      const errorResult = { success: false, message: error.message || "Test failed" };
      setTestResults((prev) => ({ ...prev, [provider]: errorResult }));
      toast.error(error.message || "Failed to test API key");
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSaveServiceKey = async (service: ServiceType) => {
    const inputs = serviceInputs[service];
    let value: string;
    let resetState: Record<string, string>;
    if (service === "dataforseo") {
      if (!inputs.login?.trim() || !inputs.password?.trim()) {
        toast.error("Please enter both DataForSEO login and password");
        return;
      }
      value = JSON.stringify({ login: inputs.login.trim(), password: inputs.password.trim() });
      resetState = { login: "", password: "" };
    } else if (service === "stripe") {
      if (!inputs.liveKey?.trim() && !inputs.testKey?.trim()) {
        toast.error("Please enter at least one Stripe key (live or test)");
        return;
      }
      value = JSON.stringify({
        ...(inputs.liveKey?.trim() ? { liveKey: inputs.liveKey.trim() } : {}),
        ...(inputs.testKey?.trim() ? { testKey: inputs.testKey.trim() } : {}),
      });
      resetState = { liveKey: "", testKey: "" };
    } else {
      if (!inputs.apiKey?.trim()) {
        toast.error("Please enter an API key");
        return;
      }
      value = inputs.apiKey.trim();
      resetState = { apiKey: "" };
    }
    try {
      await saveServiceKey.mutateAsync({ service, value });
      toast.success(`${service} credentials saved successfully`);
      setServiceInputs((prev) => ({ ...prev, [service]: resetState }));
      setTestResults((prev) => ({ ...prev, [service]: null }));
      refetchServiceKeys();
    } catch (error: any) {
      toast.error(error.message || "Failed to save service key");
    }
  };

  const handleDeleteServiceKey = async (service: ServiceType) => {
    try {
      await deleteServiceKeyMutation.mutateAsync({ service });
      toast.success(`${service} credentials deleted`);
      setTestResults((prev) => ({ ...prev, [service]: null }));
      refetchServiceKeys();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete");
    }
  };

  const handleTestServiceKey = async (service: ServiceType) => {
    setTestingService(service);
    setTestResults((prev) => ({ ...prev, [service]: null }));
    try {
      const result = await testServiceKeyMutation.mutateAsync({ service });
      setTestResults((prev) => ({ ...prev, [service]: result }));
      if (result.success) {
        toast.success(`${service} connection verified!`);
      } else {
        toast.error(`${service} test failed: ${result.message}`);
      }
      refetchServiceKeys();
    } catch (error: any) {
      const errorResult = { success: false, message: error.message || "Test failed" };
      setTestResults((prev) => ({ ...prev, [service]: errorResult }));
      toast.error(error.message || "Failed to test service key");
    } finally {
      setTestingService(null);
    }
  };

  const renderTestResult = (key: string) => {
    const result = testResults[key];
    if (!result) return null;
    return (
      <div
        className={`mt-3 p-3 rounded-lg ${
          result.success
            ? "bg-green-500/10 border border-green-500/20"
            : "bg-red-500/10 border border-red-500/20"
        }`}
      >
        <div className="flex items-start gap-2">
          {result.success ? (
            <Check className="w-5 h-5 text-green-500 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={`text-sm font-medium ${result.success ? "text-green-500" : "text-red-500"}`}>
              {result.success ? "Test Passed" : "Test Failed"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{result.message}</p>
            {result.success && result.model && (
              <p className="text-xs text-muted-foreground mt-1">
                Model: {result.model} &bull; Response time: {result.responseTime}ms
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage global API keys — entered once and used for all clients and campaigns
        </p>
      </div>

      {/* AI Provider Keys */}
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">AI Provider Keys</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Required for AI training sessions. One key per provider, shared across all campaigns.
        </p>
        <div className="grid gap-4">
          {PROVIDERS.map((p) => (
            <Card key={p.id} className="bg-card border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Key className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle>{p.label}</CardTitle>
                      <CardDescription>{p.description}</CardDescription>
                    </div>
                  </div>
                  {getKeyStatus(p.id) && (
                    <div className="flex items-center gap-2">
                      <Check className="w-5 h-5 text-green-500" />
                      <span className="text-sm text-green-500 font-medium">Connected</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`${p.id}-key`}>API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id={`${p.id}-key`}
                      type="password"
                      placeholder={getKeyStatus(p.id) ? "••••••••••••••••" : p.placeholder}
                      value={keyInputs[p.id]}
                      onChange={(e) => setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      className="bg-background border-input"
                    />
                    <Button
                      onClick={() => handleSaveKey(p.id, keyInputs[p.id])}
                      disabled={createApiKey.isPending || updateApiKey.isPending}
                    >
                      {createApiKey.isPending || updateApiKey.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : getKeyStatus(p.id) ? (
                        "Update"
                      ) : (
                        "Save"
                      )}
                    </Button>
                    {getKeyStatus(p.id) && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => handleTestKey(p.id)}
                          disabled={testingProvider === p.id}
                        >
                          {testingProvider === p.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <PlayCircle className="w-4 h-4 mr-1" />
                              Test
                            </>
                          )}
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => handleDeleteKey(p.id)}
                          disabled={deleteApiKey.isPending}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  {renderTestResult(p.id)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Service Keys */}
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Service Keys</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Required for keyword research, indexing, and email delivery. Stored encrypted.
        </p>
        <div className="grid gap-4">
          {SERVICE_CONFIGS.map((svc) => {
            const status = getServiceStatus(svc.id);
            const isSaving = saveServiceKey.isPending;
            const isDeleting = deleteServiceKeyMutation.isPending;
            const isTesting = testingService === svc.id;
            const meta = (status as any)?.metadata || {};

            return (
              <Card key={svc.id} className="bg-card border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        {svc.icon}
                      </div>
                      <div>
                        <CardTitle>{svc.label}</CardTitle>
                        <CardDescription>{svc.description}</CardDescription>
                        {/* Show saved login email for DataForSEO */}
                        {svc.id === "dataforseo" && status?.hasKey && meta.login && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Logged in as: <span className="font-medium text-foreground">{meta.login}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {status?.hasKey && (
                      <div className="flex items-center gap-2">
                        <Check className="w-5 h-5 text-green-500" />
                        <span className="text-sm text-green-500 font-medium">Connected</span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {svc.fields.map((field) => (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={`${svc.id}-${field.key}`}>{field.label}</Label>
                      <Input
                        id={`${svc.id}-${field.key}`}
                        type={field.type || "text"}
                        placeholder={status?.hasKey ? "••••••••••••••••" : field.placeholder}
                        value={serviceInputs[svc.id][field.key] || ""}
                        onChange={(e) =>
                          setServiceInputs((prev) => ({
                            ...prev,
                            [svc.id]: { ...prev[svc.id], [field.key]: e.target.value },
                          }))
                        }
                        className="bg-background border-input"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button onClick={() => handleSaveServiceKey(svc.id)} disabled={isSaving}>
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : status?.hasKey ? (
                        "Update"
                      ) : (
                        "Save"
                      )}
                    </Button>
                    {status?.hasKey && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => handleTestServiceKey(svc.id)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <PlayCircle className="w-4 h-4 mr-1" />
                              Test
                            </>
                          )}
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => handleDeleteServiceKey(svc.id)}
                          disabled={isDeleting}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  {renderTestResult(svc.id)}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Inbound Webhook Security */}
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Inbound Webhook Security</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Protect the <code className="bg-muted px-1 rounded">/api/webhooks/onboarding</code> endpoint from unauthorized requests.
          When set, every inbound webhook call must include this secret in the <code className="bg-muted px-1 rounded">x-webhook-secret</code> header.
        </p>
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Key className="w-6 h-6 text-primary" />
              <div>
                <CardTitle className="text-base">Inbound Webhook Secret</CardTitle>
                <CardDescription>Set this in your GHL workflow as the <code>x-webhook-secret</code> header value</CardDescription>
              </div>
              {savedInboundSecret && (
                <span className="ml-auto flex items-center gap-1 text-xs text-green-500 font-medium">
                  <Check className="w-3 h-3" /> Configured
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              If no secret is configured here and <code className="bg-muted px-1 rounded">WEBHOOK_SECRET</code> is not set as a Railway env var,
              the endpoint is open (development mode). Set a secret here to lock it down without touching Railway.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showInboundSecret ? "text" : "password"}
                  placeholder={savedInboundSecret ? "Secret already configured — enter new value to update" : "Enter a strong random secret"}
                  value={inboundSecretInput}
                  onChange={(e) => setInboundSecretInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowInboundSecret(!showInboundSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showInboundSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button onClick={handleSaveInboundSecret} variant="outline">
                {savedInboundSecret ? "Update" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Models Configuration */}
      <AIModelsSection />

      {/* Two-Factor Authentication */}
      <TwoFactorAuth />

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Security Information</CardTitle>
          <CardDescription>Your API keys are encrypted and stored securely</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• All keys are global — one key per provider/service, shared across all clients and campaigns</li>
            <li>• All keys are encrypted at rest using AES-256-GCM encryption</li>
            <li>• Keys saved here take priority over Railway environment variables</li>
            <li>• Keys are never exposed in logs or error messages</li>
            <li>• You can update or delete any key at any time</li>
            <li>• Use the Test button to verify a key has the required permissions</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
