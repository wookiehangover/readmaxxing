import { useEffect, useRef, useState } from "react";

export type SyncEntity =
  | "book"
  | "position"
  | "highlight"
  | "bookmark"
  | "notebook"
  | "chat_session"
  | "chat_message"
  | "settings";

export interface SyncEntityUpdateDetail {
  entity: string;
  bookIdRemap?: { fromId: string; toId: string };
}

/**
 * Returns a version counter that increments only when the specified entity
 * types are updated via sync. Components use this to re-fetch only when
 * relevant data has changed.
 */
export function useSyncListener(
  entities: SyncEntity[],
  onUpdate?: (detail: SyncEntityUpdateDetail) => void,
): number {
  const [version, setVersion] = useState(0);
  const entitiesRef = useRef(entities);
  const onUpdateRef = useRef(onUpdate);
  entitiesRef.current = entities;
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const handler = (event: CustomEvent<SyncEntityUpdateDetail>) => {
      if (entitiesRef.current.includes(event.detail.entity as SyncEntity)) {
        setVersion((v) => v + 1);
        onUpdateRef.current?.(event.detail);
      }
    };
    window.addEventListener("sync:entity-updated", handler as EventListener);
    return () => window.removeEventListener("sync:entity-updated", handler as EventListener);
  }, []);

  return version;
}
