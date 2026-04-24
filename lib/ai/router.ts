import { AIModel } from "@/types";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function callAI(
  model: AIModel,
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  switch (model) {
    case "claude":
      return callClaude(messages, systemPrompt);
    case "gpt":
      return callGPT(messages, systemPrompt);
    case "gemini":
      return callGemini(messages, systemPrompt);
    default:
      return callClaude(messages, systemPrompt);
  }
}

async function callClaude(messages: ChatMessage[], systemPrompt: string): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Claude requires messages to start with "user" role
  const filtered = messages.filter((m) => m.role !== "system");
  const startIdx = filtered.findIndex((m) => m.role === "user");
  const validMessages = startIdx >= 0 ? filtered.slice(startIdx) : filtered;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: validMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

async function callGPT(messages: ChatMessage[], systemPrompt: string): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.filter((m) => m.role !== "system"),
    ],
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content ?? "";
}

async function callGemini(messages: ChatMessage[], systemPrompt: string): Promise<string> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: systemPrompt,
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);

  return result.response.text();
}
