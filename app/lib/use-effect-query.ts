import { type DependencyList, useEffect, useState } from "react";
import { Effect } from "effect";
import { AppRuntime } from "~/lib/effect-runtime";

/**
 * React hook that runs an Effect.ts effect and manages loading, error, and data states.
 *
 * The effect is re-run whenever the dependency list changes. Stale results from
 * previous runs are automatically discarded via a cancellation flag.
 *
 * @param effectFn - Factory function returning the Effect to execute. Called on each run.
 * @param deps - React dependency list that triggers re-execution when changed.
 * @returns Object with `data`, `error`, and `isLoading` fields.
 *
 * @example
 * ```ts
 * const { data: notebook, error, isLoading } = useEffectQuery(
 *   () => AnnotationService.pipe(Effect.andThen((s) => s.getNotebook(bookId))),
 *   [bookId]
 * );
 * ```
 */
export function useEffectQuery<A, E>(
  effectFn: () => Effect.Effect<A, E, any>,
  deps: DependencyList,
): { data: A | undefined; error: E | undefined; isLoading: boolean } {
  const [data, setData] = useState<A | undefined>(undefined);
  const [error, setError] = useState<E | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);

    AppRuntime.runPromise(effectFn())
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setIsLoading(false);
        }
      })
      .catch((err: E) => {
        if (!cancelled) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, isLoading };
}
