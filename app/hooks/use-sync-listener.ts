import { useEffect, useRef, useState } from "react";

export type SyncEntity =
  | "book"
  | "position"
  | "highlight"
  | "notebook"
  | "chat_session"
  | "chat_message"
  | "settings";

/**
 * Returns a version counter that increments only when the specified entity
 * types are updated via sync. Components use this to re-fetch only when
 * relevant data has changed.
 */
export function useSyncListener(entities: SyncEntity[]): number {
  const [version, setVersion] = useState(0);
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  useEffect(() => {
    const handler = (event: CustomEvent<{ entity: string }>) => {
      if (entitiesRef.current.includes(event.detail.entity as SyncEntity)) {
        setVersion((v) => v + 1);
      }
    };
    window.addEventListener("sync:entity-updated", handler as EventListener);
    return () => window.removeEventListener("sync:entity-updated", handler as EventListener);
  }, []);

  return version;
}
