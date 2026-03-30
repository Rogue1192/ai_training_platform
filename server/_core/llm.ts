/**
 * LLM helper — standalone wrapper around aiProviders.ts
 * 
 * This module provides an OpenAI-compatible invokeLLM() interface
 * that delegates to the app's own aiProviders.ts (which calls
 * OpenAI, Anthropic, and Google APIs directly with user-provided keys).
 * 
 * If you need LLM calls in server code, prefer importing callAI() 
 * from "../aiProviders" directly — this file exists for compatibility.
 */

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

/**
 * Invoke an LLM using the app's own API key infrastructure.
 * 
 * This is a standalone implementation that calls OpenAI directly
 * using the OPENAI_API_KEY environment variable. No Manus proxy involved.
 * 
 * For training/conversation features, use callAI() from aiProviders.ts instead,
 * which supports OpenAI, Anthropic, and Google with user-provided keys.
 */
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Set it as an environment variable."
    );
  }

  const { messages, tools, toolChoice, tool_choice } = params;

  // Normalize messages to OpenAI format
  const normalizedMessages = messages.map((msg) => {
    const content = msg.content;
    if (typeof content === "string") {
      return { role: msg.role, content, ...(msg.name ? { name: msg.name } : {}), ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}) };
    }
    const parts = Array.isArray(content) ? content : [content];
    if (parts.length === 1 && typeof parts[0] !== "string" && parts[0].type === "text") {
      return { role: msg.role, content: parts[0].text, ...(msg.name ? { name: msg.name } : {}) };
    }
    return {
      role: msg.role,
      content: parts.map((p) => {
        if (typeof p === "string") return { type: "text" as const, text: p };
        return p;
      }),
      ...(msg.name ? { name: msg.name } : {}),
    };
  });

  const payload: Record<string, unknown> = {
    model: "gpt-4o",
    messages: normalizedMessages,
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const resolvedToolChoice = toolChoice || tool_choice;
  if (resolvedToolChoice) {
    if (resolvedToolChoice === "required" && tools && tools.length === 1) {
      payload.tool_choice = { type: "function", function: { name: tools[0].function.name } };
    } else if (typeof resolvedToolChoice === "object" && "name" in resolvedToolChoice) {
      payload.tool_choice = { type: "function", function: { name: resolvedToolChoice.name } };
    } else {
      payload.tool_choice = resolvedToolChoice;
    }
  }

  const maxTokens = params.maxTokens || params.max_tokens;
  if (maxTokens) {
    payload.max_tokens = maxTokens;
  }

  const responseFormat = params.responseFormat || params.response_format;
  const outputSchema = params.outputSchema || params.output_schema;
  if (responseFormat) {
    payload.response_format = responseFormat;
  } else if (outputSchema) {
    payload.response_format = {
      type: "json_schema",
      json_schema: {
        name: outputSchema.name,
        schema: outputSchema.schema,
        ...(typeof outputSchema.strict === "boolean" ? { strict: outputSchema.strict } : {}),
      },
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}
