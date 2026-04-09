import { useState, useEffect, useCallback, useRef } from "react";
import { Effect } from "effect";
import { ArrowLeft, Menu, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ChatService, type ChatSession } from "~/lib/chat-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { cn } from "~/lib/utils";

interface EditableTitleProps {
  value: string;
  onSave: (newTitle: string) => void;
  className?: string;
}

export function EditableTitle({ value, onSave, className }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn("bg-transparent outline-none border-none", className)}
      />
    );
  }

  return (
    <span className={cn("truncate", className)}>
      <span
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
        title="Click to rename"
      >
        {value || "Untitled"}
      </span>
    </span>
  );
}

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

interface SessionMenuButtonProps {
  showSessionList: boolean;
  onToggle: () => void;
}

export function SessionMenuButton({ showSessionList, onToggle }: SessionMenuButtonProps) {
  return (
    <Button variant="ghost" size="icon" className="size-7" onClick={onToggle}>
      {showSessionList ? <ArrowLeft className="size-4" /> : <Menu className="size-4" />}
      <span className="sr-only">{showSessionList ? "Back to chat" : "Sessions"}</span>
    </Button>
  );
}

interface ChatSessionListProps {
  bookId: string;
  activeSessionId: string | null;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
  onClose: () => void;
}

export function ChatSessionList({
  bookId,
  activeSessionId,
  onSwitchSession,
  onNewSession,
  onClose,
}: ChatSessionListProps) {
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
    (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      AppRuntime.runPromise(
        ChatService.pipe(Effect.andThen((s) => s.deleteSession(sessionId, bookId))),
      )
        .then(() => {
          loadSessions();
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
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-md px-4 py-4">
        {sessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No sessions yet</p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={cn(
                    "group/session flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/30",
                  )}
                  onClick={() => {
                    if (session.id === activeSessionId) {
                      onClose();
                    } else {
                      onSwitchSession(session.id);
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <EditableTitle
                      value={session.title || "Untitled"}
                      className="text-xs"
                      onSave={(newTitle) => {
                        AppRuntime.runPromise(
                          ChatService.pipe(
                            Effect.andThen((s) =>
                              s.updateSessionTitle(session.id, bookId, newTitle),
                            ),
                          ),
                        )
                          .then(() => loadSessions())
                          .catch(console.error);
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(session.updatedAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/session:opacity-100"
                    onClick={(e) => handleDelete(e, session.id)}
                    title="Delete session"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
