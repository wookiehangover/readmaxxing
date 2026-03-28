import { type DependencyList, useEffect, useRef, useState } from "react";
import { Cause, Effect, Fiber } from "effect";
import type { RuntimeFiber } from "effect/Fiber";
import { AppRuntime } from "~/lib/effect-runtime";

/**
 * React hook that runs an Effect.ts effect and manages loading, error, and data states.
 *
 * The effect is re-run whenever the dependency list changes. In-flight fibers
 * from previous runs are interrupted via `Fiber.interrupt` on cleanup.
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
  const fiberRef = useRef<RuntimeFiber<A, E> | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(undefined);

    const fiber = AppRuntime.runFork(effectFn());
    fiberRef.current = fiber;

    AppRuntime.runPromise(Fiber.join(fiber))
      .then((result) => {
        if (fiberRef.current !== fiber) return; // stale fiber, ignore
        setData(result);
        setError(undefined);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (fiberRef.current !== fiber) return; // stale fiber, ignore
        // Ignore interruption errors — they mean cleanup cancelled this fiber
        if (err instanceof Error && Cause.InterruptedExceptionTypeId in err) {
          return;
        }
        setError(err as E);
        setIsLoading(false);
      });

    return () => {
      const f = fiberRef.current;
      if (f) {
        fiberRef.current = null;
        AppRuntime.runFork(Fiber.interrupt(f));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, isLoading };
}
