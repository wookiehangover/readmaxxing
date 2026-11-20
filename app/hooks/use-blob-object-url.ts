import { useEffect, useRef, useState } from "react";

const REVOKE_DELAY_MS = 2000;

function revokeAfterDelay(url: string, pendingRevocations: Map<number, string>) {
  const timer = window.setTimeout(() => {
    URL.revokeObjectURL(url);
    pendingRevocations.delete(timer);
  }, REVOKE_DELAY_MS);
  pendingRevocations.set(timer, url);
}

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
