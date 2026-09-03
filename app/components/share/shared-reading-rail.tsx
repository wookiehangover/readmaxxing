import type { ReadingRailTab } from "~/lib/themis/reading-rail/reading-rail-types";
import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { AlertCircle, ListTree, MessageCircle } from "lucide-react";
import { Streamdown } from "streamdown";
import { READING_RAIL_MENU_ID } from "~/components/reading-shell/reading-rail-menu-portal";
import { useReadingRail } from "~/components/reading-shell/reading-rail-context";
import { TiptapEditor } from "~/components/tiptap-editor";
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
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const tabs = ["Notes", "Discuss", "Outline"] as const;

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

interface SharedArtifact {
  content: string;
  revisionId: string;
  updatedAt: string;
}

type LoadState<T> =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string"
    ? body.error
    : `Request failed with ${response.status} ${response.statusText}`;
}

function useSharedEndpoint<T>(url: string, enabled: boolean): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "idle", data: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return (await response.json()) as T;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", data, error: null });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            data: null,
            error: cause instanceof Error ? cause.message : "Request failed",
          });
        }
      });
    return () => controller.abort();
  }, [enabled, url]);

  return state;
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3 py-3 pr-6" role="status" aria-label={label}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className="py-3 pr-6">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}

function MarkdownPanel({ content, label }: { content: string; label: string }) {
  return (
    <ScrollArea className="h-full min-h-0 pr-6">
      <div aria-label={label}>
        <TiptapEditor content={content} compact editable={false} />
      </div>
    </ScrollArea>
  );
}

function NotesPanel({ state }: { state: LoadState<{ markdown: string }> }) {
  if (state.status === "idle" || state.status === "loading") {
    return <LoadingState label="Loading shared notes" />;
  }
  if (state.status === "error") {
    return <ErrorState title="Could not load shared notes" message={state.error} />;
  }
  if (!state.data.markdown.trim()) {
    return null;
  }
  return <MarkdownPanel content={state.data.markdown} label="Shared notes" />;
}

function SharedChatBubble({ message }: { message: SharedChatMessage }) {
  const isUser = message.role === "user";
  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <Bubble align={isUser ? "end" : "start"} variant={isUser ? "secondary" : "ghost"}>
          <BubbleContent>
            {message.role === "assistant" ? (
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

function DiscussPanel({ shareId, included, active }: RailPanelProps) {
  const state = useSharedEndpoint<{ sessions: SharedChatSession[] }>(
    `/api/share/${encodeURIComponent(shareId)}/chats`,
    included && active,
  );

  if (!included) {
    return (
      <Empty className="h-full rounded-none border-0 pr-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircle />
          </EmptyMedia>
          <EmptyTitle>Discussion not included</EmptyTitle>
          <EmptyDescription>Chat sessions were not included with this share link.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (state.status === "idle" || state.status === "loading") {
    return <LoadingState label="Loading shared chats" />;
  }
  if (state.status === "error") {
    return <ErrorState title="Could not load shared chats" message={state.error} />;
  }
  const session = state.data.sessions[0];
  if (!session) {
    return (
      <Empty className="h-full rounded-none border-0 pr-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircle />
          </EmptyMedia>
          <EmptyTitle>No shared chats</EmptyTitle>
          <EmptyDescription>There are no chat sessions for this book yet.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <MessageScrollerProvider autoScroll={false}>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="flex flex-col gap-5 pr-6">
            <section className="flex min-w-0 flex-col gap-3">
              <div>
                <h3 className="text-sm font-medium">{session.title || "Untitled chat"}</h3>
                <p className="text-xs text-muted-foreground">{session.messages.length} messages</p>
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
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function OutlinePanel({ shareId, active }: Omit<RailPanelProps, "included">) {
  const state = useSharedEndpoint<{ artifact: SharedArtifact | null }>(
    `/api/share/${encodeURIComponent(shareId)}/artifacts`,
    active,
  );

  if (state.status === "idle" || state.status === "loading") {
    return <LoadingState label="Loading shared outline" />;
  }
  if (state.status === "error") {
    return <ErrorState title="Could not load shared outline" message={state.error} />;
  }
  if (!state.data.artifact?.content.trim()) {
    return (
      <Empty className="h-full rounded-none border-0 pr-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTree />
          </EmptyMedia>
          <EmptyTitle>No outline yet</EmptyTitle>
          <EmptyDescription>
            The sharer does not have an outline for this book yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <MarkdownPanel content={state.data.artifact.content} label="Shared outline" />;
}

interface RailPanelProps {
  shareId: string;
  included: boolean;
  active: boolean;
}

export function SharedReadingRail({
  shareId,
  bookTitle,
  included,
  mobile = false,
  bookSurface,
}: {
  shareId: string;
  bookTitle: string;
  included: boolean;
  mobile?: boolean;
  bookSurface?: ReactNode;
}) {
  const { activeTab, setActiveTab } = useReadingRail();
  const notebookState = useSharedEndpoint<{ markdown: string }>(
    `/api/share/${encodeURIComponent(shareId)}/notebook`,
    included,
  );
  const showNotes =
    included && notebookState.status === "ready" && Boolean(notebookState.data.markdown.trim());
  const availableTabs = showNotes ? tabs : tabs.filter((tab) => tab !== "Notes");
  const mobileTabs = ["Read", ...availableTabs] as const;
  const resolvedActiveTab = mobile
    ? !showNotes && activeTab === "Notes"
      ? "Read"
      : activeTab
    : activeTab === "Read" || (!showNotes && activeTab === "Notes")
      ? "Discuss"
      : activeTab;

  const panels = (
    <>
      {showNotes ? (
        <Tabs.Panel
          value="Notes"
          keepMounted
          className="min-h-0 flex-1 overflow-hidden outline-none"
        >
          <NotesPanel state={notebookState} />
        </Tabs.Panel>
      ) : null}
      <Tabs.Panel
        value="Discuss"
        keepMounted
        className="min-h-0 flex-1 overflow-hidden outline-none"
      >
        <DiscussPanel
          shareId={shareId}
          included={included}
          active={resolvedActiveTab === "Discuss"}
        />
      </Tabs.Panel>
      <Tabs.Panel
        value="Outline"
        keepMounted
        className="min-h-0 flex-1 overflow-hidden outline-none"
      >
        <OutlinePanel shareId={shareId} active={resolvedActiveTab === "Outline"} />
      </Tabs.Panel>
    </>
  );

  if (mobile) {
    return (
      <Tabs.Root
        className="flex h-full min-h-0 flex-col bg-background"
        value={resolvedActiveTab}
        onValueChange={(value) => setActiveTab(value as ReadingRailTab)}
        data-testid="mobile-reading-tabs"
      >
        <Tabs.Panel
          value="Read"
          keepMounted
          aria-label="Book surface"
          className="min-h-0 flex-1 overflow-hidden outline-none"
        >
          {bookSurface}
        </Tabs.Panel>
        {panels}
        <div className="flex shrink-0 items-start gap-3 bg-background px-6 pt-3 pb-3">
          <Tabs.List
            aria-label="Reading sections"
            className="relative flex min-w-0 flex-1 items-center gap-5"
          >
            {mobileTabs.map((tab) => (
              <Tabs.Tab
                key={tab}
                value={tab}
                className={cn(
                  "relative h-7 shrink-0 bg-transparent p-0 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  { "text-foreground": resolvedActiveTab === tab },
                )}
              >
                {tab}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator className="absolute bottom-0 left-[var(--active-tab-left)] h-px w-3 bg-foreground transition-[left] duration-200 ease-out motion-reduce:transition-none" />
          </Tabs.List>
          <div id={READING_RAIL_MENU_ID} className="flex min-h-7 shrink-0 items-center" />
        </div>
      </Tabs.Root>
    );
  }

  return (
    <Tabs.Root
      className="flex h-full min-h-0 flex-col py-5 pl-6"
      value={resolvedActiveTab}
      onValueChange={(value) => setActiveTab(value as ReadingRailTab)}
      data-testid="share-reading-rail"
    >
      <div className="flex items-start gap-3 pr-6">
        <Tabs.List
          aria-label="Reading tools"
          className="relative flex min-w-0 flex-1 items-center gap-5"
        >
          {availableTabs.map((tab) => (
            <Tabs.Tab
              key={tab}
              value={tab}
              className={cn(
                "relative h-7 shrink-0 bg-transparent p-0 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                { "text-foreground": resolvedActiveTab === tab },
              )}
            >
              {tab}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator
            data-testid="rail-tab-indicator"
            className="absolute bottom-0 left-[var(--active-tab-left)] h-px w-3 bg-foreground transition-[left] duration-200 ease-out motion-reduce:transition-none"
          />
        </Tabs.List>
        <div id={READING_RAIL_MENU_ID} className="flex min-h-7 shrink-0 items-center" />
      </div>
      <div className="min-h-12 py-3 pr-6 text-xs">
        <p className="truncate text-foreground">{bookTitle}</p>
      </div>
      {panels}
    </Tabs.Root>
  );
}
