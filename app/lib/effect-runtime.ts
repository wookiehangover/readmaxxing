import { Layer, ManagedRuntime } from "effect";
import { AnnotationServiceLive } from "~/lib/stores/annotations-store";
import { BookServiceLive } from "~/lib/stores/book-store";
import { EpubServiceLive } from "~/lib/epub/epub-service";
import { LocationCacheServiceLive } from "~/lib/stores/location-cache-store";
import { ReadingPositionServiceLive } from "~/lib/stores/position-store";
import { StandardEbooksServiceLive } from "~/lib/standard-ebooks";
import { WorkspaceServiceLive } from "~/lib/stores/workspace-store";
import { ChatServiceLive } from "~/lib/stores/chat-store";
import { PdfServiceLive } from "~/lib/pdf/pdf-service";
import { AuthServiceLive } from "~/lib/auth-service";

/**
 * Application-wide layer that composes all service layers.
 * Add service layers here as they are created.
 */
export const AppLayer = Layer.mergeAll(
  BookServiceLive,
  EpubServiceLive,
  PdfServiceLive,
  AnnotationServiceLive,
  LocationCacheServiceLive,
  ReadingPositionServiceLive,
  StandardEbooksServiceLive,
  WorkspaceServiceLive,
  ChatServiceLive,
  AuthServiceLive,
);

/**
 * Shared ManagedRuntime for the application.
 * Use `AppRuntime.runPromise(effect)` or `AppRuntime.runSync(effect)`
 * at call sites to execute effects with all application services provided.
 */
export const AppRuntime = ManagedRuntime.make(AppLayer);
