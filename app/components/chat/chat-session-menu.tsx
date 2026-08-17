import { useState, useEffect, useCallback } from "react";
import { Effect } from "effect";
import { Check, Trash2 } from "lucide-react";
import { DropdownMenuGroup, DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { ChatService, type ChatSession } from "~/lib/stores/chat-store";
import { AppRuntime } from "~/lib/effect-runtime";

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

interface ChatRecentSessionsMenuProps {
  bookId: string;
  activeSessionId: string | null;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export function ChatRecentSessionsMenu({
  bookId,
  activeSessionId,
  onSwitchSession,
  onNewSession,
}: ChatRecentSessionsMenuProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const loadSessions = useCallback(() => {
    AppRuntime.runPromise(ChatService.pipe(Effect.andThen((s) => s.getSessionsByBook(bookId))))
      .then((result) => {
        const sorted = [...result].sort((a, b) => b.updatedAt - a.updatedAt);
        setSessions(sorted);
      })
      .catch(console.error);
  }, [bookId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleDelete = useCallback(
    (event: React.MouseEvent, sessionId: string) => {
      event.stopPropagation();
      AppRuntime.runPromise(
        ChatService.pipe(Effect.andThen((service) => service.deleteSession(sessionId, bookId))),
      )
        .then(() => {
          loadSessions();
          if (sessionId !== activeSessionId) return;
          return AppRuntime.runPromise(
            ChatService.pipe(Effect.andThen((service) => service.getActiveSessionId(bookId))),
          ).then((nextActiveId) => {
            if (nextActiveId) onSwitchSession(nextActiveId);
            else onNewSession();
          });
        })
        .catch(console.error);
    },
    [activeSessionId, bookId, loadSessions, onNewSession, onSwitchSession],
  );

  return (
    <DropdownMenuGroup>
      {sessions.length === 0 ? (
        <DropdownMenuItem disabled>No recent chats</DropdownMenuItem>
      ) : (
        sessions.map((session) => (
          <DropdownMenuItem
            key={session.id}
            onClick={() => {
              if (session.id !== activeSessionId) onSwitchSession(session.id);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{session.title || "Untitled"}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(session.updatedAt)}
            </span>
            {session.id === activeSessionId ? <Check className="ml-auto" /> : null}
            <button
              type="button"
              className="ml-auto rounded p-0.5 text-muted-foreground hover:text-destructive"
              onClick={(event) => handleDelete(event, session.id)}
              title="Delete session"
            >
              <Trash2 />
              <span className="sr-only">Delete {session.title || "Untitled"}</span>
            </button>
          </DropdownMenuItem>
        ))
      )}
    </DropdownMenuGroup>
  );
}
