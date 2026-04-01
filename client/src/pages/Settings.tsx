import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Check, X, Key, PlayCircle, AlertCircle, Database, Mail, Search, Palette } from "lucide-react";
import TwoFactorAuth from "@/components/TwoFactorAuth";

type AIProvider = "openai" | "anthropic" | "google";
type ServiceType = "dataforseo" | "sinbyte" | "resend" | "whitelabel";

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
    id: "sinbyte",
    label: "SinByte",
    description: "Fast Google indexing for published content pages",
    icon: <Database className="w-6 h-6 text-primary" />,
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sb-...", type: "password" },
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
];

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
  });

  const [serviceInputs, setServiceInputs] = useState<Record<ServiceType, Record<string, string>>>({
    dataforseo: { login: "", password: "" },
    sinbyte: { apiKey: "" },
    resend: { apiKey: "" },
    whitelabel: {
      companyName: "",
      fromEmail: "",
      supportEmail: "",
      appUrl: "",
      footerText: "",
      logoUrl: "",
    },
  });

  const [testingProvider, setTestingProvider] = useState<AIProvider | null>(null);
  const [testingService, setTestingService] = useState<ServiceType | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string; model?: string; responseTime?: number } | null>
  >({});

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

    if (service === "dataforseo") {
      if (!inputs.login?.trim() || !inputs.password?.trim()) {
        toast.error("Please enter both DataForSEO login and password");
        return;
      }
      value = JSON.stringify({ login: inputs.login.trim(), password: inputs.password.trim() });
    } else if (service === "whitelabel") {
      if (!inputs.companyName?.trim()) {
        toast.error("Company name is required");
        return;
      }
      // Only save fields that have values
      const wl: Record<string, string> = {};
      if (inputs.companyName?.trim()) wl.companyName = inputs.companyName.trim();
      if (inputs.fromEmail?.trim()) wl.fromEmail = inputs.fromEmail.trim();
      if (inputs.supportEmail?.trim()) wl.supportEmail = inputs.supportEmail.trim();
      if (inputs.appUrl?.trim()) wl.appUrl = inputs.appUrl.trim();
      if (inputs.footerText?.trim()) wl.footerText = inputs.footerText.trim();
      if (inputs.logoUrl?.trim()) wl.logoUrl = inputs.logoUrl.trim();
      value = JSON.stringify(wl);
    } else {
      if (!inputs.apiKey?.trim()) {
        toast.error("Please enter an API key");
        return;
      }
      value = inputs.apiKey.trim();
    }

    try {
      await saveServiceKey.mutateAsync({ service, value });
      toast.success(
        service === "whitelabel"
          ? "White-label settings saved successfully"
          : `${service} credentials saved successfully`
      );
      // Clear inputs after save
      if (service === "whitelabel") {
        setServiceInputs((prev) => ({
          ...prev,
          whitelabel: { companyName: "", fromEmail: "", supportEmail: "", appUrl: "", footerText: "", logoUrl: "" },
        }));
      } else {
        setServiceInputs((prev) => ({
          ...prev,
          [service]: service === "dataforseo" ? { login: "", password: "" } : { apiKey: "" },
        }));
      }
      setTestResults((prev) => ({ ...prev, [service]: null }));
      refetchServiceKeys();
    } catch (error: any) {
      toast.error(error.message || "Failed to save settings");
    }
  };

  const handleDeleteServiceKey = async (service: ServiceType) => {
    try {
      await deleteServiceKeyMutation.mutateAsync({ service });
      toast.success(
        service === "whitelabel" ? "White-label settings deleted" : `${service} credentials deleted`
      );
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

  const whiteLabelStatus = getServiceStatus("whitelabel");
  const whiteLabelMeta = whiteLabelStatus?.metadata || {};

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
            const meta = status?.metadata || {};

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
                        {/* Show saved email for DataForSEO */}
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

      {/* White-Label Branding */}
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">White-Label Branding</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Customize the company name, email sender, and branding used in all client-facing emails and the dashboard.
          Leave blank to use the default AI Answer Forge branding.
        </p>
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Palette className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle>Brand Settings</CardTitle>
                  <CardDescription>
                    Applied to all client emails — win notifications, baseline reports, upgrade emails
                  </CardDescription>
                  {whiteLabelStatus?.hasKey && whiteLabelMeta.companyName && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Currently set to: <span className="font-medium text-foreground">{whiteLabelMeta.companyName}</span>
                    </p>
                  )}
                </div>
              </div>
              {whiteLabelStatus?.hasKey && (
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">Configured</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Show current saved values if configured */}
            {whiteLabelStatus?.hasKey && Object.keys(whiteLabelMeta).length > 0 && (
              <div className="p-3 rounded-lg bg-muted/40 border border-border space-y-1 text-sm">
                <p className="font-medium text-foreground mb-2">Current Settings</p>
                {whiteLabelMeta.companyName && (
                  <p className="text-muted-foreground">Company Name: <span className="text-foreground">{whiteLabelMeta.companyName}</span></p>
                )}
                {whiteLabelMeta.fromEmail && (
                  <p className="text-muted-foreground">From Email: <span className="text-foreground">{whiteLabelMeta.fromEmail}</span></p>
                )}
                {whiteLabelMeta.supportEmail && (
                  <p className="text-muted-foreground">Support Email: <span className="text-foreground">{whiteLabelMeta.supportEmail}</span></p>
                )}
                {whiteLabelMeta.appUrl && (
                  <p className="text-muted-foreground">App URL: <span className="text-foreground">{whiteLabelMeta.appUrl}</span></p>
                )}
                {whiteLabelMeta.footerText && (
                  <p className="text-muted-foreground">Footer Text: <span className="text-foreground">{whiteLabelMeta.footerText}</span></p>
                )}
                {whiteLabelMeta.logoUrl && (
                  <p className="text-muted-foreground">Logo URL: <span className="text-foreground">{whiteLabelMeta.logoUrl}</span></p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="wl-companyName">Company Name *</Label>
                <Input
                  id="wl-companyName"
                  placeholder={whiteLabelMeta.companyName || "AI Answer Forge"}
                  value={serviceInputs.whitelabel.companyName}
                  onChange={(e) =>
                    setServiceInputs((prev) => ({
                      ...prev,
                      whitelabel: { ...prev.whitelabel, companyName: e.target.value },
                    }))
                  }
                  className="bg-background border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-fromEmail">From Email</Label>
                <Input
                  id="wl-fromEmail"
                  type="email"
                  placeholder={whiteLabelMeta.fromEmail || "Your Company <updates@yourdomain.com>"}
                  value={serviceInputs.whitelabel.fromEmail}
                  onChange={(e) =>
                    setServiceInputs((prev) => ({
                      ...prev,
                      whitelabel: { ...prev.whitelabel, fromEmail: e.target.value },
                    }))
                  }
                  className="bg-background border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-supportEmail">Support Email</Label>
                <Input
                  id="wl-supportEmail"
                  type="email"
                  placeholder={whiteLabelMeta.supportEmail || "support@yourdomain.com"}
                  value={serviceInputs.whitelabel.supportEmail}
                  onChange={(e) =>
                    setServiceInputs((prev) => ({
                      ...prev,
                      whitelabel: { ...prev.whitelabel, supportEmail: e.target.value },
                    }))
                  }
                  className="bg-background border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-appUrl">App / Dashboard URL</Label>
                <Input
                  id="wl-appUrl"
                  placeholder={whiteLabelMeta.appUrl || "https://yourdomain.com"}
                  value={serviceInputs.whitelabel.appUrl}
                  onChange={(e) =>
                    setServiceInputs((prev) => ({
                      ...prev,
                      whitelabel: { ...prev.whitelabel, appUrl: e.target.value },
                    }))
                  }
                  className="bg-background border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-footerText">Email Footer Text</Label>
                <Input
                  id="wl-footerText"
                  placeholder={whiteLabelMeta.footerText || "Powered by Your Company"}
                  value={serviceInputs.whitelabel.footerText}
                  onChange={(e) =>
                    setServiceInputs((prev) => ({
                      ...prev,
                      whitelabel: { ...prev.whitelabel, footerText: e.target.value },
                    }))
                  }
                  className="bg-background border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-logoUrl">Logo URL (optional)</Label>
                <Input
                  id="wl-logoUrl"
                  placeholder={whiteLabelMeta.logoUrl || "https://yourdomain.com/logo.png"}
                  value={serviceInputs.whitelabel.logoUrl}
                  onChange={(e) =>
                    setServiceInputs((prev) => ({
                      ...prev,
                      whitelabel: { ...prev.whitelabel, logoUrl: e.target.value },
                    }))
                  }
                  className="bg-background border-input"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => handleSaveServiceKey("whitelabel")}
                disabled={saveServiceKey.isPending}
              >
                {saveServiceKey.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : whiteLabelStatus?.hasKey ? (
                  "Update Branding"
                ) : (
                  "Save Branding"
                )}
              </Button>
              {whiteLabelStatus?.hasKey && (
                <Button
                  variant="destructive"
                  onClick={() => handleDeleteServiceKey("whitelabel")}
                  disabled={deleteServiceKeyMutation.isPending}
                >
                  <X className="w-4 h-4 mr-1" />
                  Reset to Default
                </Button>
              )}
            </div>
            {renderTestResult("whitelabel")}
          </CardContent>
        </Card>
      </div>

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
