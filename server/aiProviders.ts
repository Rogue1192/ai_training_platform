import axios from "axios";

export type AIProvider = "openai" | "anthropic" | "google" | "minimax";

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIResponse {
  content: string;
  responseTime: number;
}

// ============= Provider-specific callers =============

/**
 * Call OpenAI API
 */
async function callOpenAI(apiKey: string, model: string, messages: AIMessage[]): Promise<AIResponse> {
  const startTime = Date.now();
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model, messages },
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
 * Call MiniMax API (Anthropic-compatible format)
 * Base URL: https://api.minimax.io/anthropic
 */
async function callMiniMax(apiKey: string, model: string, messages: AIMessage[]): Promise<AIResponse> {
  const startTime = Date.now();
  try {
    const systemMessage = messages.find((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const response = await axios.post(
      "https://api.minimax.io/anthropic/v1/messages",
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
    throw new Error(`MiniMax API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Call Google Gemini API
 * @param options.webSearch  When true, enables Google Search grounding so Gemini
 *   can retrieve live web results — matching how real users experience Gemini
 *   with web access enabled. Required for accurate rank checks on local businesses.
 */
async function callGoogle(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  options?: { webSearch?: boolean }
): Promise<AIResponse> {
  const startTime = Date.now();
  try {
    const systemMessage = messages.find((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const contents = conversationMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const requestBody: any = {
      contents,
      systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
    };

    // Enable Google Search grounding when requested — makes Gemini behave like
    // the real-world experience where users have web access enabled.
    // Supported on gemini-2.0-flash and later models.
    if (options?.webSearch) {
      requestBody.tools = [{ google_search: {} }];
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      requestBody,
      { headers: { "Content-Type": "application/json" } }
    );
    const responseTime = Date.now() - startTime;
    // When web search grounding is active the response may contain multiple parts
    // (text + grounding metadata). Concatenate all text parts.
    const parts = response.data.candidates?.[0]?.content?.parts || [];
    const content = parts.map((p: any) => p.text || "").join("");
    return { content, responseTime };
  } catch (error: any) {
    throw new Error(`Google AI API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

// ============= Deprecated model resolution =============

/**
 * Map of deprecated model names to their current replacements.
 * When a model is deprecated by its provider, add a mapping here
 * so existing sessions with the old model name continue to work.
 */
export const DEPRECATED_MODEL_MAP: Record<string, string> = {
  // Google
  "gemini-2.0-flash-exp": "gemini-2.0-flash",
  "gemini-pro": "gemini-1.5-pro",
  // Anthropic
  "claude-3-opus-20240229": "claude-opus-4-5-20251101",
  "claude-3-sonnet-20240229": "claude-sonnet-4-5-20250929",
  "claude-3-haiku-20240307": "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-20250514": "claude-sonnet-4-5-20250929",
  // OpenAI
  "gpt-4-turbo-preview": "gpt-4o",
  "gpt-4": "gpt-4o",
};

/**
 * Resolve a model name, replacing deprecated models with their current equivalents.
 */
export function resolveModel(model: string): string {
  const resolved = DEPRECATED_MODEL_MAP[model];
  if (resolved) {
    console.log(`[AI Provider] Model "${model}" is deprecated, using "${resolved}" instead`);
    return resolved;
  }
  return model;
}

// ============= Main callAI entry point =============

/**
 * Generic AI provider call — dispatches to the correct provider.
 * @param options.webSearch  Google only: enable Google Search grounding.
 */
export async function callAI(
  provider: AIProvider,
  apiKey: string,
  model: string,
  messages: AIMessage[],
  options?: { webSearch?: boolean }
): Promise<AIResponse> {
  const resolvedModel = resolveModel(model);
  switch (provider) {
    case "openai":
      return callOpenAI(apiKey, resolvedModel, messages);
    case "anthropic":
      return callAnthropic(apiKey, resolvedModel, messages);
    case "google":
      return callGoogle(apiKey, resolvedModel, messages, options);
    case "minimax":
      return callMiniMax(apiKey, resolvedModel, messages);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

// ============= Model lists =============

/**
 * Get available models for a provider.
 */
export function getAvailableModels(provider: AIProvider): string[] {
  switch (provider) {
    case "openai":
      return [
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4o",
        "gpt-4o-mini",
        "o3",
        "o3-mini",
        "gpt-3.5-turbo",
      ];
    case "anthropic":
      return [
        "claude-opus-4-5-20251101",
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
      ];
    case "google":
      return [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
      ];
    case "minimax":
      return [
        "MiniMax-M2.7",
        "MiniMax-M2.7-highspeed",
        "MiniMax-M2.5",
        "MiniMax-M2",
      ];
    default:
      return [];
  }
}

// ============= Key verification =============

/**
 * Verify API key by making a test call.
 */
export async function verifyApiKey(
  provider: AIProvider,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const models = getAvailableModels(provider);
    const testModel = models[0];
    if (!testModel) {
      return { valid: false, error: `No models available for provider: ${provider}` };
    }
    await callAI(provider, apiKey, testModel, [{ role: "user", content: "Hello" }]);
    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error?.message || String(error) };
  }
}

/**
 * Test API key with a real API call and return detailed results for the Settings UI.
 */
export async function testApiKey(
  provider: AIProvider,
  apiKey: string
): Promise<{
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

    const result = await callAI(provider, apiKey, testModel, [
      { role: "user", content: "Say 'API key is working!' in exactly those words." },
    ]);

    return {
      success: true,
      message: "API key is valid and working correctly",
      model: testModel,
      responseTime: result.responseTime,
      response: result.content.substring(0, 100),
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
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


