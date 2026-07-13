import { useEffect, useRef } from "react";

export function useResumeMessage({
  resumeMessage,
  isLoading,
  gated,
  sendMessage,
  onResumeComplete,
  inputRef,
  textareaRef,
}: {
  resumeMessage: string | undefined;
  isLoading: boolean;
  gated: boolean;
  sendMessage: (message: { text: string }) => Promise<void>;
  onResumeComplete?: () => void;
  inputRef: React.MutableRefObject<string>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}): void {
  const resumedMessageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resumeMessage) {
      resumedMessageRef.current = null;
      return;
    }
    if (gated || isLoading || resumedMessageRef.current === resumeMessage) return;
    resumedMessageRef.current = resumeMessage;
    const messageToSend = resumeMessage;
    inputRef.current = "";
    if (textareaRef.current) textareaRef.current.value = "";
    sendMessage({ text: messageToSend })
      .then(() => onResumeComplete?.())
      .catch((error: unknown) => {
        console.error("Failed to resume chat message:", error);
        // Reset the de-dupe guard so the user can retry, and restore the text
        // they typed before signup into both the ref and the textarea.
        resumedMessageRef.current = null;
        inputRef.current = messageToSend;
        if (textareaRef.current) textareaRef.current.value = messageToSend;
      });
  }, [inputRef, isLoading, gated, onResumeComplete, resumeMessage, sendMessage, textareaRef]);
}
