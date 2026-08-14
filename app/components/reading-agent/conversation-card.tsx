import { MessageSquareText } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import type {
  ReadingAgentConversation,
  SanitizedConversationMessage,
  SanitizedConversationPart,
} from "~/lib/reading-agent/conversation";

function phaseVariant(phase: ReadingAgentConversation["phase"]) {
  if (phase === "error") return "destructive" as const;
  if (phase === "live") return "default" as const;
  return "secondary" as const;
}

function toolLabel(part: Extract<SanitizedConversationPart, { type: "dynamic-tool" }>): string {
  if (part.state === "output-error") return `${part.toolName} failed`;
  if (part.state === "output-available") return part.toolName;
  return `${part.toolName}…`;
}

function MessageParts({ message }: { message: SanitizedConversationMessage }) {
  if (message.role === "user" || message.purpose === "dispatch") {
    return <p className="text-sm text-muted-foreground">Ingest unit submitted</p>;
  }

  const visible = message.parts.filter((part) => part.type !== "text" || part.text.length > 0);
  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">Waiting for the next reply…</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((part, index) => {
        if (part.type === "dynamic-tool") {
          return (
            <Badge key={`${message.id}-tool-${index}`} variant="outline">
              {toolLabel(part)}
            </Badge>
          );
        }
        return (
          <p
            key={`${message.id}-${part.type}-${index}`}
            className={cn("whitespace-pre-wrap text-sm", {
              "italic text-muted-foreground": part.type === "reasoning",
            })}
          >
            {part.text}
          </p>
        );
      })}
    </div>
  );
}

export function ConversationCard({
  conversation,
  error,
}: {
  conversation: ReadingAgentConversation;
  error: string | null;
}) {
  const visibleMessages = conversation.messages.filter((message) => message.display !== "hidden");
  const empty = conversation.phase !== "error" && visibleMessages.length === 0 && !error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live conversation</CardTitle>
        <CardDescription>
          Reasoning, tool names, and reply text for the current lease
        </CardDescription>
        <CardAction>
          <Badge variant={phaseVariant(conversation.phase)}>{conversation.phase}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {conversation.phase === "loading" ? (
          <Skeleton className="h-28 w-full" />
        ) : error || conversation.phase === "error" ? (
          <p className="text-sm text-destructive">
            {error || "Unable to load the live conversation."}
          </p>
        ) : empty ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquareText />
              </EmptyMedia>
              <EmptyTitle>No live conversation</EmptyTitle>
              <EmptyDescription>
                {conversation.phase === "connecting"
                  ? "The current lease is waiting for the agent host conversation."
                  : "A processing lease will stream reasoning and replies here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="flex max-h-80 flex-col gap-4 overflow-y-auto pr-1">
            {visibleMessages.map((message) => (
              <li key={message.id} className="flex flex-col gap-1">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {message.role}
                </p>
                <MessageParts message={message} />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
