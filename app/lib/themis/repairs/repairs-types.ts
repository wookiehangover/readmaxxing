import type { RepairJob } from "~/lib/repair/repair-types";
import type { fork } from "typed-redux-saga";

export type RepairTask =
  ReturnType<typeof fork> extends Generator<unknown, infer Task, unknown> ? Task : never;

export interface BookRepairState {
  job: RepairJob | null;
  operation: "starting" | "saving" | null;
  error: string | null;
  replaced: boolean;
}
export interface RepairsState {
  byBookId: Record<string, BookRepairState>;
}
