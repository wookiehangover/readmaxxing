import { generateText, type UIMessage } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";

interface ChatTitleRequestBody {
  messages: UIMessage[];
}

export async function action({ request }: { request: Request }) {
  // Require authentication before generating titles
  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const body = (await request.json()) as ChatTitleRequestBody;
  const { messages } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Missing or invalid messages" }, { status: 400 });
  }

  // Only generate titles for early conversations
  if (messages.length > 10) {
    return Response.json({ error: "Too many messages for title generation" }, { status: 400 });
  }

  const historyString = messages
    .slice(0, 6)
    .map((message) => {
      const textParts = Array.isArray(message.parts)
        ? message.parts
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n")
        : "";
      return `<message role="${message.role}">\n${textParts}\n</message>`;
    })
    .join("\n\n");

  const { text } = await generateText({
    model: gateway("google/gemini-2.5-flash"),
    messages: [
      {
        role: "system",
        content:
          "You are an expert at creating short titles for reading discussion sessions. Given the conversation, create a concise title that captures the main topic being discussed about the book. The title should be 50 characters or less. ONLY RESPOND WITH THE TITLE TEXT, no quotes, no preamble, no other text.",
      },
      {
        role: "user",
        content: `Here is the conversation so far:\n\n${historyString}\n\nRemember: ONLY RESPOND WITH THE TITLE TEXT, no quotes, no preamble.`,
      },
    ],
  });

  return Response.json({ title: text.trim() });
}
