import { Layer, ManagedRuntime } from "effect";
import { AnnotationServiceLive } from "~/lib/annotations-store";
import { BookServiceLive } from "~/lib/book-store";
import { EpubServiceLive } from "~/lib/epub-service";
import { LocationCacheServiceLive } from "~/lib/location-cache-store";
import { ReadingPositionServiceLive } from "~/lib/position-store";
import { StandardEbooksServiceLive } from "~/lib/standard-ebooks";
import { WorkspaceServiceLive } from "~/lib/workspace-store";
import { ChatServiceLive } from "~/lib/chat-store";

/**
 * Application-wide layer that composes all service layers.
 * Add service layers here as they are created.
 */
export const AppLayer = Layer.mergeAll(
  BookServiceLive,
  EpubServiceLive,
  AnnotationServiceLive,
  LocationCacheServiceLive,
  ReadingPositionServiceLive,
  StandardEbooksServiceLive,
  WorkspaceServiceLive,
  ChatServiceLive,
);

/**
 * Shared ManagedRuntime for the application.
 * Use `AppRuntime.runPromise(effect)` or `AppRuntime.runSync(effect)`
 * at call sites to execute effects with all application services provided.
 */
export const AppRuntime = ManagedRuntime.make(AppLayer);
