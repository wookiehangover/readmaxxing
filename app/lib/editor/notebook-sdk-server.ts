import vm from "node:vm";
import type { JSONContent } from "@tiptap/react";
import { parseHTML } from "linkedom";

let domInstalled = false;
function ensureServerDom(): void {
  if (domInstalled) return;
  if (typeof (globalThis as any).document !== "undefined") {
    domInstalled = true;
    return;
  }

  const { window, document } = parseHTML("<!DOCTYPE html><html><head></head><body></body></html>");
  const g = globalThis as any;
  g.window = window;
  g.document = document;
  g.DocumentFragment = (window as any).DocumentFragment;
  g.Node = (window as any).Node;
  g.Element = (window as any).Element;
  g.HTMLElement = (window as any).HTMLElement;
  g.Text = (window as any).Text;
  try {
    g.navigator = (window as any).navigator;
  } catch {}
  g.innerHeight = 800;
  g.innerWidth = 1200;
  const fakeSelection = {
    rangeCount: 0,
    removeAllRanges() {},
    addRange() {},
    toString: () => "",
  };
  g.getSelection = () => fakeSelection;
  (window as any).getSelection = g.getSelection;
  (document as any).getSelection = g.getSelection;

  domInstalled = true;
}

export interface RunEditNotesOk {
  ok: true;
  updatedContent: JSONContent;
}

export interface RunEditNotesErr {
  ok: false;
  error: string;
}

export type RunEditNotesResult = RunEditNotesOk | RunEditNotesErr;

const MIN_INPUT_BLOCKS_FOR_GUARD = 3;
const SHRINK_FLOOR = 0.25;

function topLevelBlockCount(content: JSONContent): number {
  return content.content?.length ?? 0;
}

export async function runEditNotesInSandbox(
  content: JSONContent,
  code: string,
  opts: { timeoutMs?: number } = {},
): Promise<RunEditNotesResult> {
  const timeoutMs = opts.timeoutMs ?? 1500;

  ensureServerDom();

  const [{ createNotebookSDK }, { markdownToTiptapJsonServer }] = await Promise.all([
    import("./notebook-sdk"),
    import("./markdown-to-tiptap-server"),
  ]);
  const { sdk, getResult, destroy } = createNotebookSDK(content, {
    parseMarkdown: markdownToTiptapJsonServer,
  });
  try {
    const script = new vm.Script(`(function(notebook){\n${code}\n})(notebook)`);
    const ctx = vm.createContext({
      notebook: sdk,
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    try {
      script.runInContext(ctx, { timeout: timeoutMs });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        return { ok: false, error: `edit_notes: code timed out after ${timeoutMs}ms` };
      }
      return { ok: false, error: e?.message ?? String(err) };
    }
    const updatedContent = getResult();

    const inputBlocks = topLevelBlockCount(content);
    const outputBlocks = topLevelBlockCount(updatedContent);
    if (inputBlocks >= MIN_INPUT_BLOCKS_FOR_GUARD && outputBlocks < inputBlocks * SHRINK_FLOOR) {
      return {
        ok: false,
        error:
          `edit_notes: script reduced the notebook from ${inputBlocks} blocks to ${outputBlocks}. ` +
          `This looks like an accidental wipe. Use replace(block, ...) / remove(block) / ` +
          `insertAfter(block, ...) / insertBefore(block, ...) to edit specific blocks rather than ` +
          `rewriting the whole notebook. If the user explicitly asked to reset the notebook, ` +
          `call remove() on each block in a loop instead.`,
      };
    }

    return { ok: true, updatedContent };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: e?.message ?? String(err) };
  } finally {
    try {
      destroy();
    } catch {}
  }
}
