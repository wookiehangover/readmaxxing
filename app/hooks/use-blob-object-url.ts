import { useEffect, useRef, useState } from "react";

const REVOKE_DELAY_MS = 2000;

function revokeAfterDelay(url: string, pendingRevocations: Map<number, string>) {
  const timer = window.setTimeout(() => {
    URL.revokeObjectURL(url);
    pendingRevocations.delete(timer);
  }, REVOKE_DELAY_MS);
  pendingRevocations.set(timer, url);
}

/**
 * Creates an object URL for a Blob and revokes it lazily.
 *
 * - `key` is a stable identifier for the underlying cover (e.g. bookId).
 *   When `key` does not change, the hook keeps the existing URL even if the
 *   `blob` reference changes — important because IndexedDB returns fresh
 *   Blob instances on every read and sync re-fetches the whole book list.
 * - When `key` changes, a new URL is created and the previous URL is revoked
 *   after a short delay, so Safari can finish decoding the new <img src>
 *   before the old URL is torn down.
 * - On unmount, any live URL is revoked.
 */
export function useBlobObjectUrl(
  blob: Blob | null,
  key: string | number | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const keyRef = useRef<string | number | null>(null);
  const urlRef = useRef<string | null>(null);
  const pendingRevocationsRef = useRef(new Map<number, string>());

  useEffect(() => {
    if (!blob || key == null) {
      const prev = urlRef.current;
      keyRef.current = null;
      urlRef.current = null;
      if (prev) {
        setUrl(null);
        revokeAfterDelay(prev, pendingRevocationsRef.current);
      }
      return;
    }
    if (keyRef.current === key && urlRef.current) return;
    const next = URL.createObjectURL(blob);
    const prev = urlRef.current;
    keyRef.current = key;
    urlRef.current = next;
    setUrl(next);
    if (prev) {
      revokeAfterDelay(prev, pendingRevocationsRef.current);
    }
  }, [blob, key]);

  useEffect(() => {
    return () => {
      const currentUrl = urlRef.current;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      keyRef.current = null;
      urlRef.current = null;

      for (const [timer, pendingUrl] of pendingRevocationsRef.current) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(pendingUrl);
      }
      pendingRevocationsRef.current.clear();
    };
  }, []);

  return url;
}
