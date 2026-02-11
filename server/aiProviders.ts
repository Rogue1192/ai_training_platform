import axios from "axios";

export type AIProvider = "openai" | "anthropic" | "google";

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIResponse {
  content: string;
  responseTime: number;
}

/**
 * Call OpenAI API
 */
async function callOpenAI(apiKey: string, model: string, messages: AIMessage[]): Promise<AIResponse> {
  const startTime = Date.now();

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const responseTime = Date.now() - startTime;
    const content = response.data.choices[0]?.message?.content || "";

    return { content, responseTime };
  } catch (error: any) {
    throw new Error(`OpenAI API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Call Anthropic API
 */
async function callAnthropic(apiKey: string, model: string, messages: AIMessage[]): Promise<AIResponse> {
  const startTime = Date.now();

  try {
    // Convert messages to Anthropic format
    const systemMessage = messages.find((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model,
        max_tokens: 4096,
        system: systemMessage?.content,
        messages: conversationMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      }
    );

    const responseTime = Date.now() - startTime;
    const content = response.data.content[0]?.text || "";

    return { content, responseTime };
  } catch (error: any) {
    throw new Error(`Anthropic API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Call Google AI API
 */
async function callGoogle(apiKey: string, model: string, messages: AIMessage[]): Promise<AIResponse> {
  const startTime = Date.now();

  try {
    // Convert messages to Google format
    const systemMessage = messages.find((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const contents = conversationMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        contents,
        systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const responseTime = Date.now() - startTime;
    const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return { content, responseTime };
  } catch (error: any) {
    throw new Error(`Google AI API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Map of deprecated model names to their current replacements.
 * When a model is deprecated by its provider, add a mapping here
 * so existing sessions with the old model name continue to work.
 */
const DEPRECATED_MODEL_MAP: Record<string, string> = {
  "gemini-2.0-flash-exp": "gemini-2.0-flash",
  "gemini-pro": "gemini-1.5-pro",
  "claude-3-opus-20240229": "claude-sonnet-4-5-20250929",
  "claude-3-sonnet-20240229": "claude-sonnet-4-5-20250929",
  "claude-3-haiku-20240307": "claude-haiku-4-5-20251001",
};

/**
 * Resolve a model name, replacing deprecated models with their current equivalents.
 */
function resolveModel(model: string): string {
  const resolved = DEPRECATED_MODEL_MAP[model];
  if (resolved) {
    console.log(`[AI Provider] Model "${model}" is deprecated, using "${resolved}" instead`);
    return resolved;
  }
  return model;
}

/**
 * Generic AI provider call
 */
export async function callAI(provider: AIProvider, apiKey: string, model: string, messages: AIMessage[]): Promise<AIResponse> {
  const resolvedModel = resolveModel(model);
  
  switch (provider) {
    case "openai":
      return callOpenAI(apiKey, resolvedModel, messages);
    case "anthropic":
      return callAnthropic(apiKey, resolvedModel, messages);
    case "google":
      return callGoogle(apiKey, resolvedModel, messages);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Get available models for a provider
 */
export function getAvailableModels(provider: AIProvider): string[] {
  switch (provider) {
    case "openai":
      return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
    case "anthropic":
      // Updated to current Claude 4.5 models (Jan 2026)
      return ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001", "claude-opus-4-5-20251101"];
    case "google":
      return ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
    default:
      return [];
  }
}

/**
 * Verify API key by making a test call
 */
export async function verifyApiKey(provider: AIProvider, apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const models = getAvailableModels(provider);
    const testModel = models[0];

    if (!testModel) {
      return { valid: false, error: `No models available for provider: ${provider}` };
    }

    console.log(`[API Verification] Testing ${provider} with model ${testModel}...`);
    console.log(`[API Verification] API key starts with: ${apiKey.substring(0, 10)}...`);
    
    await callAI(provider, apiKey, testModel, [{ role: "user", content: "Hello" }]);
    console.log(`[API Verification] ${provider} verification successful`);
    return { valid: true };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error(`[API Verification] ${provider} verification failed:`, errorMessage);
    return { valid: false, error: errorMessage };
  }
}

/**
 * Test API key with a real API call and return detailed results
 */
export async function testApiKey(provider: AIProvider, apiKey: string): Promise<{
  success: boolean;
  message: string;
  model?: string;
  responseTime?: number;
  response?: string;
}> {
  try {
    const models = getAvailableModels(provider);
    const testModel = models[0];

    if (!testModel) {
      return { success: false, message: `No models available for provider: ${provider}` };
    }

    console.log(`[API Test] Testing ${provider} with model ${testModel}...`);
    
    const result = await callAI(provider, apiKey, testModel, [
      { role: "user", content: "Say 'API key is working!' in exactly those words." }
    ]);
    
    console.log(`[API Test] ${provider} test successful - response time: ${result.responseTime}ms`);
    
    return {
      success: true,
      message: `API key is valid and working correctly`,
      model: testModel,
      responseTime: result.responseTime,
      response: result.content.substring(0, 100), // Truncate for display
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error(`[API Test] ${provider} test failed:`, errorMessage);
    
    // Parse common error types for user-friendly messages
    let userMessage = errorMessage;
    if (errorMessage.includes("401") || errorMessage.includes("invalid_api_key") || errorMessage.includes("Invalid API")) {
      userMessage = "Invalid API key. Please check your key and try again.";
    } else if (errorMessage.includes("429") || errorMessage.includes("rate_limit")) {
      userMessage = "Rate limit exceeded. Please wait a moment and try again.";
    } else if (errorMessage.includes("403") || errorMessage.includes("permission")) {
      userMessage = "API key lacks required permissions. Please check your API key settings.";
    } else if (errorMessage.includes("model")) {
      userMessage = `Model access error: ${errorMessage}`;
    }
    
    return { success: false, message: userMessage };
  }
}
