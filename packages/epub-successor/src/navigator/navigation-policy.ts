import type { DisplayTarget, Relocation } from "./navigator";

export interface NavigatorNavigationPolicy {
  resolve(target: DisplayTarget): DisplayTarget | false;
  allowCommit(target: DisplayTarget): boolean;
  allowMovement(direction: "next" | "previous" | "restore" | "speedread"): boolean;
  boundary(direction: "next" | "previous", current: Relocation): DisplayTarget | false | undefined;
}
