import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { BookMeta } from "~/lib/stores/book-store";

export interface ChatBookSelection {
  openBooks: BookMeta[];
  selectedBookIds: string[];
  ownBookId: string;
  onToggleBook: (id: string) => void;
}

export interface ReadingChatMenuActions {
  bookId: string;
  activeSessionId: string;
  bookSelection: ChatBookSelection;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
}

type RegisterActions = (actions: ReadingChatMenuActions) => () => void;

const ReadingChatMenuActionsContext = createContext<ReadingChatMenuActions | null>(null);
const ReadingChatMenuRegistrationContext = createContext<RegisterActions | null>(null);

export function ReadingChatMenuProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReadingChatMenuActions | null>(null);
  const registerActions = useCallback<RegisterActions>((nextActions) => {
    setActions(nextActions);
    return () => setActions((current) => (current === nextActions ? null : current));
  }, []);

  return (
    <ReadingChatMenuRegistrationContext.Provider value={registerActions}>
      <ReadingChatMenuActionsContext.Provider value={actions}>
        {children}
      </ReadingChatMenuActionsContext.Provider>
    </ReadingChatMenuRegistrationContext.Provider>
  );
}

export function useReadingChatMenuActions() {
  return useContext(ReadingChatMenuActionsContext);
}

export function useReadingChatMenuRegistration() {
  return useContext(ReadingChatMenuRegistrationContext);
}
