import { useEffect, useRef, useState } from "react";

const REVOKE_DELAY_MS = 2000;

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
  const [url, setUrl] = useState<string | null>(() =>
    blob && key != null ? URL.createObjectURL(blob) : null,
  );
  const keyRef = useRef<string | number | null>(blob && key != null ? key : null);
  const urlRef = useRef<string | null>(url);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    if (!blob || key == null) {
      const prev = urlRef.current;
      keyRef.current = null;
      setUrl(null);
      if (prev) {
        const t = window.setTimeout(() => URL.revokeObjectURL(prev), REVOKE_DELAY_MS);
        return () => window.clearTimeout(t);
      }
      return;
    }
    if (keyRef.current === key) return;
    const next = URL.createObjectURL(blob);
    const prev = urlRef.current;
    keyRef.current = key;
    setUrl(next);
    if (prev) {
      const t = window.setTimeout(() => URL.revokeObjectURL(prev), REVOKE_DELAY_MS);
      return () => window.clearTimeout(t);
    }
  }, [blob, key]);

  useEffect(() => {
    return () => {
      const u = urlRef.current;
      if (u) URL.revokeObjectURL(u);
    };
  }, []);

  return url;
}
