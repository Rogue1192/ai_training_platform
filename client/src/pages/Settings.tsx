import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Check, X, Key, PlayCircle, AlertCircle } from "lucide-react";
import TwoFactorAuth from "@/components/TwoFactorAuth";
import PromptTemplateEditor from "@/components/PromptTemplateEditor";

export default function Settings() {
  const { data: apiKeys, isLoading, refetch } = trpc.apiKey.list.useQuery();
  const createApiKey = trpc.apiKey.create.useMutation();
  const updateApiKey = trpc.apiKey.update.useMutation();
  const deleteApiKey = trpc.apiKey.delete.useMutation();
  const testApiKey = trpc.apiKey.test.useMutation();

  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; model?: string; responseTime?: number } | null>>({});

  const getKeyStatus = (provider: "openai" | "anthropic" | "google") => {
    return apiKeys?.find((k) => k.provider === provider);
  };

  const handleSaveKey = async (provider: "openai" | "anthropic" | "google", key: string) => {
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

      // Clear input and test results
      if (provider === "openai") setOpenaiKey("");
      if (provider === "anthropic") setAnthropicKey("");
      if (provider === "google") setGoogleKey("");
      setTestResults(prev => ({ ...prev, [provider]: null }));

      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to save API key");
    }
  };

  const handleDeleteKey = async (provider: "openai" | "anthropic" | "google") => {
    try {
      await deleteApiKey.mutateAsync({ provider });
      toast.success(`${provider.toUpperCase()} API key deleted`);
      setTestResults(prev => ({ ...prev, [provider]: null }));
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete API key");
    }
  };

  const handleTestKey = async (provider: "openai" | "anthropic" | "google") => {
    setTestingProvider(provider);
    setTestResults(prev => ({ ...prev, [provider]: null }));
    
    try {
      const result = await testApiKey.mutateAsync({ provider });
      setTestResults(prev => ({ ...prev, [provider]: result }));
      
      if (result.success) {
        toast.success(`${provider.toUpperCase()} API key is working! Response time: ${result.responseTime}ms`);
      } else {
        toast.error(`${provider.toUpperCase()} test failed: ${result.message}`);
      }
      refetch();
    } catch (error: any) {
      const errorResult = { success: false, message: error.message || "Test failed" };
      setTestResults(prev => ({ ...prev, [provider]: errorResult }));
      toast.error(error.message || "Failed to test API key");
    } finally {
      setTestingProvider(null);
    }
  };

  const renderTestResult = (provider: "openai" | "anthropic" | "google") => {
    const result = testResults[provider];
    if (!result) return null;

    return (
      <div className={`mt-3 p-3 rounded-lg ${result.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
        <div className="flex items-start gap-2">
          {result.success ? (
            <Check className="w-5 h-5 text-green-500 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={`text-sm font-medium ${result.success ? 'text-green-500' : 'text-red-500'}`}>
              {result.success ? 'Test Passed' : 'Test Failed'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{result.message}</p>
            {result.success && result.model && (
              <p className="text-xs text-muted-foreground mt-1">
                Model: {result.model} • Response time: {result.responseTime}ms
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
        <p className="text-muted-foreground mt-2">Manage global AI provider API keys — entered once and used for all clients and campaigns</p>
      </div>

      <div className="grid gap-6">
        {/* OpenAI */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Key className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle>OpenAI</CardTitle>
                  <CardDescription>GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo</CardDescription>
                </div>
              </div>
              {getKeyStatus("openai") && (
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">Connected</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openai-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="openai-key"
                  type="password"
                  placeholder={getKeyStatus("openai") ? "••••••••••••••••" : "sk-..."}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  className="bg-background border-input"
                />
                <Button
                  onClick={() => handleSaveKey("openai", openaiKey)}
                  disabled={createApiKey.isPending || updateApiKey.isPending}
                >
                  {createApiKey.isPending || updateApiKey.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : getKeyStatus("openai") ? (
                    "Update"
                  ) : (
                    "Save"
                  )}
                </Button>
                {getKeyStatus("openai") && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleTestKey("openai")}
                      disabled={testingProvider === "openai"}
                    >
                      {testingProvider === "openai" ? (
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
                      onClick={() => handleDeleteKey("openai")}
                      disabled={deleteApiKey.isPending}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
              {renderTestResult("openai")}
            </div>
          </CardContent>
        </Card>

        {/* Anthropic */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Key className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle>Anthropic</CardTitle>
                  <CardDescription>Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.5</CardDescription>
                </div>
              </div>
              {getKeyStatus("anthropic") && (
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">Connected</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="anthropic-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="anthropic-key"
                  type="password"
                  placeholder={getKeyStatus("anthropic") ? "••••••••••••••••" : "sk-ant-..."}
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  className="bg-background border-input"
                />
                <Button
                  onClick={() => handleSaveKey("anthropic", anthropicKey)}
                  disabled={createApiKey.isPending || updateApiKey.isPending}
                >
                  {createApiKey.isPending || updateApiKey.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : getKeyStatus("anthropic") ? (
                    "Update"
                  ) : (
                    "Save"
                  )}
                </Button>
                {getKeyStatus("anthropic") && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleTestKey("anthropic")}
                      disabled={testingProvider === "anthropic"}
                    >
                      {testingProvider === "anthropic" ? (
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
                      onClick={() => handleDeleteKey("anthropic")}
                      disabled={deleteApiKey.isPending}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
              {renderTestResult("anthropic")}
            </div>
          </CardContent>
        </Card>

        {/* Google AI */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Key className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle>Google AI</CardTitle>
                  <CardDescription>Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash</CardDescription>
                </div>
              </div>
              {getKeyStatus("google") && (
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">Connected</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="google-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="google-key"
                  type="password"
                  placeholder={getKeyStatus("google") ? "••••••••••••••••" : "AIza..."}
                  value={googleKey}
                  onChange={(e) => setGoogleKey(e.target.value)}
                  className="bg-background border-input"
                />
                <Button
                  onClick={() => handleSaveKey("google", googleKey)}
                  disabled={createApiKey.isPending || updateApiKey.isPending}
                >
                  {createApiKey.isPending || updateApiKey.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : getKeyStatus("google") ? (
                    "Update"
                  ) : (
                    "Save"
                  )}
                </Button>
                {getKeyStatus("google") && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleTestKey("google")}
                      disabled={testingProvider === "google"}
                    >
                      {testingProvider === "google" ? (
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
                      onClick={() => handleDeleteKey("google")}
                      disabled={deleteApiKey.isPending}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
              {renderTestResult("google")}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Prompt Templates */}
      <PromptTemplateEditor />

      {/* Two-Factor Authentication */}
      <TwoFactorAuth />

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Security Information</CardTitle>
          <CardDescription>Your API keys are encrypted and stored securely</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• API keys are global — one key per provider, shared across all clients and campaigns</li>
            <li>• All API keys are encrypted at rest using AES-256-GCM encryption</li>
            <li>• Keys are verified upon submission to ensure they work correctly</li>
            <li>• API keys are never exposed in logs or error messages</li>
            <li>• You can update or delete any key at any time</li>
            <li>• Use the Test button to verify a key has the required permissions</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
