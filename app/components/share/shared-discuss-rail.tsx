import { useEffect, useState } from "react";
import { AlertCircle, MessageCircle } from "lucide-react";
import { Streamdown } from "streamdown";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Message, MessageContent } from "~/components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "~/components/ui/message-scroller";
import { Skeleton } from "~/components/ui/skeleton";

interface SharedChatMessage {
  role: string;
  content: string;
  createdAt: string;
}

interface SharedChatSession {
  id: string;
  title: string | null;
  messages: SharedChatMessage[];
}

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string"
    ? body.error
    : `Request failed with ${response.status} ${response.statusText}`;
}

async function loadSharedChats(shareId: string, signal: AbortSignal) {
  const response = await fetch(`/api/share/${encodeURIComponent(shareId)}/chats`, { signal });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as { sessions: SharedChatSession[] };
}

function SharedChatBubble({ message }: { message: SharedChatMessage }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <Bubble align={isUser ? "end" : "start"} variant={isUser ? "secondary" : "ghost"}>
          <BubbleContent>
            {isAssistant ? (
              <div className="typeset [--typeset-flow:0.75em] [--typeset-leading:1.6] [--typeset-size:0.875rem]">
                <Streamdown>{message.content}</Streamdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-5 p-5" role="status" aria-label="Loading shared chats">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-4/5 self-end" />
      </div>
      <span className="sr-only">Loading shared chats…</span>
    </div>
  );
}

function EmptyChats({ included }: { included: boolean }) {
  return (
    <Empty className="rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircle />
        </EmptyMedia>
        <EmptyTitle>{included ? "No shared chats" : "Discussion not included"}</EmptyTitle>
        <EmptyDescription>
          {included
            ? "There are no chat sessions for this book yet."
            : "Chat sessions were not included with this share link."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function SharedDiscussRail({ shareId, included }: { shareId: string; included: boolean }) {
  const [sessions, setSessions] = useState<SharedChatSession[]>([]);
  const [loading, setLoading] = useState(included);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!included) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadSharedChats(shareId, controller.signal)
      .then(({ sessions: nextSessions }) => {
        setSessions(nextSessions);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Failed to load shared chats");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [included, shareId]);

  return (
    <aside
      className="flex min-h-[40dvh] min-w-0 flex-col border-t bg-background md:min-h-0 md:border-t-0 md:border-l"
      aria-label="Discuss"
      data-testid="share-discuss-rail"
    >
      <header className="flex h-12 shrink-0 items-center border-b px-5" role="tablist">
        <div
          id="share-discuss-tab"
          className="text-sm font-medium"
          role="tab"
          aria-controls="share-discuss-panel"
          aria-selected="true"
        >
          Discuss
        </div>
      </header>
      <div
        id="share-discuss-panel"
        className="min-h-0 flex-1"
        role="tabpanel"
        aria-labelledby="share-discuss-tab"
      >
        {!included ? (
          <EmptyChats included={false} />
        ) : loading ? (
          <LoadingState />
        ) : error ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Could not load shared chats</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : sessions.length === 0 ? (
          <EmptyChats included />
        ) : (
          <MessageScrollerProvider autoScroll={false}>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="p-5">
                  {sessions.map((session) => (
                    <section key={session.id} className="flex min-w-0 flex-col gap-3">
                      <div>
                        <h3 className="text-sm font-medium">{session.title || "Untitled chat"}</h3>
                        <p className="text-xs text-muted-foreground">
                          {session.messages.length} messages
                        </p>
                      </div>
                      <div className="flex min-w-0 flex-col gap-3">
                        {session.messages.map((message, index) => {
                          const messageId = `${session.id}-${message.createdAt}-${index}`;
                          return (
                            <MessageScrollerItem key={messageId} messageId={messageId}>
                              <SharedChatBubble message={message} />
                            </MessageScrollerItem>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>
    </aside>
  );
}
