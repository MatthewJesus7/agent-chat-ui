// src/providers/types.ts
import { validate } from "uuid";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  created_at?: string;
}

export interface ContentBlock {
  type: "text" | "image_url" | string;
  text?: string;
  image_url?: { url: string };
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Thread {
  thread_id: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
  values?: Record<string, unknown>;
}

export interface UIMessage {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface RemoveUIMessage {
  id: string;
  type: "remove";
}

export interface StateType {
  messages: Message[];
  ui?: UIMessage[];
}

export interface Checkpoint {
  checkpoint_id?: string;
  thread_id?: string;
}

export interface MessageMetadata {
  firstSeenState?: {
    parent_checkpoint?: Checkpoint;
    checkpoint?: Checkpoint;
    values?: StateType;
  };
}

export interface BackendCheckpoint {
  values?: {
    messages?: Message[];
    ui?: UIMessage[];
  };
}

export function isUIMessage(event: unknown): event is UIMessage {
  return (
    typeof event === "object" &&
    event !== null &&
    "id" in event &&
    "type" in event &&
    (event as RemoveUIMessage).type !== "remove"
  );
}

export function isRemoveUIMessage(event: unknown): event is RemoveUIMessage {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event as RemoveUIMessage).type === "remove"
  );
}

export function uiMessageReducer(
  state: UIMessage[],
  action: UIMessage | RemoveUIMessage
): UIMessage[] {
  if (isRemoveUIMessage(action)) {
    return state.filter((m) => m.id !== action.id);
  }
  const idx = state.findIndex((m) => m.id === action.id);
  if (idx === -1) return [...state, action];
  const next = [...state];
  next[idx] = action;
  return next;
}


export function buildThreadMetadata(assistantId: string): Record<string, string> {
  return validate(assistantId)
    ? { assistant_id: assistantId }
    : { graph_id: assistantId };
}