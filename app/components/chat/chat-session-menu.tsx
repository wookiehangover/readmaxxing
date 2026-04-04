import { useState, useEffect, useCallback } from "react";
import { Effect } from "effect";
import { Menu, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChatService, type ChatSession } from "~/lib/chat-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { cn } from "~/lib/utils";

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface ChatSessionMenuProps {
  bookId: string;
  activeSessionId: string | null;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export function ChatSessionMenu({
  bookId,
  activeSessionId,
  onSwitchSession,
  onNewSession,
}: ChatSessionMenuProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [open, setOpen] = useState(false);

  const loadSessions = useCallback(() => {
    AppRuntime.runPromise(ChatService.pipe(Effect.andThen((s) => s.getSessionsByBook(bookId))))
      .then((result) => {
        // Sort by most recent first
        const sorted = [...result].sort((a, b) => b.updatedAt - a.updatedAt);
        setSessions(sorted);
      })
      .catch(console.error);
  }, [bookId]);

  // Reload sessions when menu opens
  useEffect(() => {
    if (open) {
      loadSessions();
    }
  }, [open, loadSessions]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      AppRuntime.runPromise(
        ChatService.pipe(Effect.andThen((s) => s.deleteSession(sessionId, bookId))),
      )
        .then(() => {
          loadSessions();
          // If we deleted the active session, switch to the most recent remaining
          if (sessionId === activeSessionId) {
            AppRuntime.runPromise(
              ChatService.pipe(Effect.andThen((s) => s.getActiveSessionId(bookId))),
            )
              .then((newActiveId) => {
                if (newActiveId) {
                  onSwitchSession(newActiveId);
                } else {
                  onNewSession();
                }
              })
              .catch(console.error);
          }
        })
        .catch(console.error);
    },
    [bookId, activeSessionId, loadSessions, onSwitchSession, onNewSession],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7">
            <Menu className="size-4" />
            <span className="sr-only">Chat sessions</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={4} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Chat Sessions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {sessions.map((session) => (
            <DropdownMenuItem
              key={session.id}
              className={cn("group/session flex items-center justify-between pr-1", {
                "bg-accent/50": session.id === activeSessionId,
              })}
              onClick={() => {
                if (session.id !== activeSessionId) {
                  onSwitchSession(session.id);
                }
                setOpen(false);
              }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm">{session.title || "Untitled"}</span>
                <span className="text-[11px] text-muted-foreground">
                  {formatRelativeTime(session.updatedAt)}
                  {session.messages.length > 0 &&
                    ` · ${session.messages.length} message${session.messages.length !== 1 ? "s" : ""}`}
                </span>
              </div>
              {sessions.length > 1 && (
                <button
                  type="button"
                  className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-focus/session:opacity-100 group-hover/session:opacity-100"
                  onClick={(e) => handleDelete(e, session.id)}
                  title="Delete session"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          {sessions.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No sessions yet
            </div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
