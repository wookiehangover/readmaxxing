import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResumeMessage } from "../use-resume-message";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function Harness({
  sendMessage,
  onResumeComplete,
  inputRef,
  textareaRef,
  initialResumeMessage,
  onReady,
}: {
  sendMessage: (message: { text: string }) => Promise<void>;
  onResumeComplete?: () => void;
  inputRef: React.MutableRefObject<string>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  initialResumeMessage?: string;
  onReady?: (setResume: (v: string | undefined) => void) => void;
}) {
  const [resumeMessage, setResumeMessage] = useState<string | undefined>(initialResumeMessage);
  React.useEffect(() => {
    onReady?.(setResumeMessage);
  }, [onReady]);
  useResumeMessage({
    resumeMessage,
    isLoading: false,
    gated: false,
    sendMessage,
    onResumeComplete,
    inputRef,
    textareaRef,
  });
  return <textarea ref={textareaRef} defaultValue="" />;
}

describe("useResumeMessage", () => {
  it("clears intent only after sendMessage resolves", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const inputRef = { current: "" };
    let resolveSend!: () => void;
    const sendMessage = vi.fn(() => new Promise<void>((resolve) => (resolveSend = resolve)));
    const onResumeComplete = vi.fn();

    await act(async () => {
      root.render(
        <Harness
          sendMessage={sendMessage}
          onResumeComplete={onResumeComplete}
          inputRef={inputRef}
          textareaRef={textareaRef}
          initialResumeMessage="hello world"
        />,
      );
    });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(onResumeComplete).not.toHaveBeenCalled();
    expect(inputRef.current).toBe("");
    expect(textareaRef.current!.value).toBe("");

    await act(async () => {
      resolveSend();
      await Promise.resolve();
    });

    expect(onResumeComplete).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("restores the input and allows retry when sendMessage rejects", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const inputRef = { current: "" };
    let call = 0;
    const sendMessage = vi.fn(() => {
      call += 1;
      return call === 1 ? Promise.reject(new Error("network fail")) : Promise.resolve();
    });
    const onResumeComplete = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let setResume!: (v: string | undefined) => void;

    await act(async () => {
      root.render(
        <Harness
          sendMessage={sendMessage}
          onResumeComplete={onResumeComplete}
          inputRef={inputRef}
          textareaRef={textareaRef}
          initialResumeMessage="please retry"
          onReady={(fn) => (setResume = fn)}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(onResumeComplete).not.toHaveBeenCalled();
    expect(inputRef.current).toBe("please retry");
    expect(textareaRef.current!.value).toBe("please retry");

    await act(async () => {
      setResume(undefined);
    });
    await act(async () => {
      setResume("please retry");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(onResumeComplete).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
    act(() => root.unmount());
  });
});
