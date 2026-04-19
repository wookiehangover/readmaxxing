import vm from "node:vm";
import type { JSONContent } from "@tiptap/react";
import { parseHTML } from "linkedom";

/**
 * TipTap's Editor class needs a DOM to construct its ProseMirror view, even
 * when used headlessly. On the server we install a minimal linkedom-based
 * shim on `globalThis` the first time this module is used. The shim is
 * idempotent and safe to call in every request.
 */
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
  } catch {
    // navigator may be a read-only getter in some runtimes; ignore.
  }
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

/**
 * Guard against accidental whole-document wipes. If the input had at least
 * MIN_INPUT_BLOCKS top-level nodes and the result shrunk to less than
 * SHRINK_FLOOR of that count, reject the edit. This catches the common
 * failure mode where an AI-generated script reassembles the whole notebook
 * and drops most of it, while still allowing legitimate bulk removals
 * (e.g. delete 2 of 3 paragraphs — 3 → 1 is blocked only if the rule fires,
 * but 3 → 1 passes SHRINK_FLOOR=0.25 * 3 = 0.75 → 1 ≥ 0.75, so OK).
 */
const MIN_INPUT_BLOCKS_FOR_GUARD = 3;
const SHRINK_FLOOR = 0.25;

function topLevelBlockCount(content: JSONContent): number {
  return content.content?.length ?? 0;
}

/**
 * Runs AI-supplied `code` against a `notebook` SDK bound to `content` inside a
 * `node:vm` context with a timeout. The code has no access to `require`,
 * network, fs, or host globals — only `notebook` and a minimal `console`.
 *
 * Returns `{ ok: true, updatedContent }` on success or `{ ok: false, error }`
 * for any thrown error or timeout.
 */
export async function runEditNotesInSandbox(
  content: JSONContent,
  code: string,
  opts: { timeoutMs?: number } = {},
): Promise<RunEditNotesResult> {
  const timeoutMs = opts.timeoutMs ?? 1500;

  ensureServerDom();

  // Dynamic import so the TipTap / DOM work only runs when a tool call hits us.
  const { createNotebookSDK } = await import("./notebook-sdk");
  const { sdk, getResult, destroy } = createNotebookSDK(content);
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
    } catch {
      // Tolerate cleanup errors — the editor may already be half-destroyed.
    }
  }
}
