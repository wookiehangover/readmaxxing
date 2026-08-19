import { ReactStore } from "@augmentcode/themis/react-store";

const placeholderInitialState = {};

// The books slice will replace this placeholder in the next migration task.
const placeholderReducer = (state = placeholderInitialState) => state;

export function createAppStore() {
  return new ReactStore({ placeholder: placeholderReducer });
}

export type AppStore = ReturnType<typeof createAppStore>;
