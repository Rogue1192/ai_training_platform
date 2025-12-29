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
 * Generic AI provider call
 */
export async function callAI(provider: AIProvider, apiKey: string, model: string, messages: AIMessage[]): Promise<AIResponse> {
  switch (provider) {
    case "openai":
      return callOpenAI(apiKey, model, messages);
    case "anthropic":
      return callAnthropic(apiKey, model, messages);
    case "google":
      return callGoogle(apiKey, model, messages);
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
      return ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"];
    case "google":
      return ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"];
    default:
      return [];
  }
}

/**
 * Verify API key by making a test call
 */
export async function verifyApiKey(provider: AIProvider, apiKey: string): Promise<boolean> {
  try {
    const models = getAvailableModels(provider);
    const testModel = models[0];

    if (!testModel) {
      return false;
    }

    await callAI(provider, apiKey, testModel, [{ role: "user", content: "Hello" }]);
    return true;
  } catch (error) {
    console.error(`API key verification failed for ${provider}:`, error);
    return false;
  }
}
