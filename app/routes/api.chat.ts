import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { Route } from "./+types/api.chat";

interface ChatRequestBody {
  messages: UIMessage[];
  bookContext: {
    title: string;
    author: string;
    textExcerpt: string;
  };
}

export async function action({ request }: Route.ActionArgs) {
  const body = (await request.json()) as ChatRequestBody;
  const { messages, bookContext } = body;

  if (!messages || !Array.isArray(messages)) {
    return new Response("Missing or invalid messages", { status: 400 });
  }

  if (!bookContext?.title || !bookContext?.author || !bookContext?.textExcerpt) {
    return new Response("Missing required bookContext fields", { status: 400 });
  }

  const systemPrompt = `You are a knowledgeable reading companion discussing ${bookContext.title} by ${bookContext.author}. Answer questions based on the provided book text. Quote specific passages when relevant. If a question goes beyond the provided text, say so clearly.

--- BOOK TEXT ---
${bookContext.textExcerpt}
--- END BOOK TEXT ---`;

  const result = streamText({
    model: gateway("anthropic/claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
