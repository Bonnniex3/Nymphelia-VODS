import { useMemo } from "react";
import { extractTriggers } from "./triggers";

const NONE = [];

/** Trigger timestamps for a loaded chat replay (see useChatReplay). Empty until the chat is ready. */
export default function useTriggers(chat) {
  const ready = chat.status === "ready";
  const { messages, offset } = chat;
  return useMemo(() => (ready ? extractTriggers(messages, offset) : NONE), [ready, messages, offset]);
}
