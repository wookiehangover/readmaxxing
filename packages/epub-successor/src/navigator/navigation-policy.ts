import type { DisplayTarget, Relocation } from "./navigator";

/** Host-owned admission; the engine owns layout and never stores review business state. */
export interface NavigatorNavigationPolicy {
  resolve(target: DisplayTarget): DisplayTarget | false;
  allowCommit(target: DisplayTarget): boolean;
  allowMovement(direction: "next" | "previous" | "restore" | "speedread"): boolean;
  boundary(direction: "next" | "previous", current: Relocation): DisplayTarget | false | undefined;
}
