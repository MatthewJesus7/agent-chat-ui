// src/providers/use-stream.ts

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  Message,
  Thread,
  UIMessage,
  RemoveUIMessage,
  StateType,
  MessageMetadata,
  BackendCheckpoint,
} from "./types";
import { isUIMessage, isRemoveUIMessage, buildThreadMetadata } from "./types";

export interface UseStreamOptions {
  apiUrl: string;
  apiKey?: string;
  assistantId: string;
  threadId: string | null;
  fetchStateHistory?: boolean;
  extraBody?: Record<string, unknown>;
  onCustomEvent?: (
    event: UIMessage | RemoveUIMessage,
    options: { mutate: (fn: (prev: StateType) => StateType) => void }
  ) => void;
  onThreadId?: (id: string) => void;
}

export interface UseStreamReturn {
  values: StateType;
  submit: (
    input: Record<string, unknown>,
    options?: { config?: Record<string, unknown> }
  ) => void;
  stop: () => void;
  isLoading: boolean;
  error: Error | null;
  threadId: string | null;
  messages: Message[];
  getMessagesMetadata: (message: Message) => MessageMetadata | undefined;
  interrupt: null;
  experimental_branchData: undefined;
  setBranch: (branchId: string) => void;
  getBranch: () => string | null;
}

const EMPTY_STATE: StateType = { messages: [], ui: [] };

export function useStream(options: UseStreamOptions): UseStreamReturn {
  const {
    apiUrl,
    apiKey,
    assistantId,
    threadId,
    fetchStateHistory,
    extraBody,
    onCustomEvent,
    onThreadId,
  } = options;

  const [values, setValues] = useState<StateType>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Rastreia o último threadId para detectar troca real de thread
  const prevThreadIdRef = useRef<string | null>(null);

  const mutate = useCallback((fn: (prev: StateType) => StateType) => {
    setValues((prev) => fn(prev));
  }, []);

  const buildHeaders = useCallback(
    (accept?: string): Record<string, string> => {
      const h: Record<string, string> = {
        "Content-Type": "application/json",
        ...(accept ? { Accept: accept } : {}),
      };
      if (apiKey) h["x-api-key"] = apiKey;
      return h;
    },
    [apiKey]
  );

  // FIX 3 + 7: Limpa estado ao trocar de thread e recarrega histórico
  useEffect(() => {
    const threadChanged = threadId !== prevThreadIdRef.current;
    prevThreadIdRef.current = threadId;

    // Thread nova ou nula → limpa mensagens imediatamente
    if (!threadId) {
      setValues(EMPTY_STATE);
      return;
    }

    if (!fetchStateHistory) return;

    // Limpa antes de buscar para não mostrar mensagens antigas
    if (threadChanged) {
      setValues(EMPTY_STATE);
    }

    fetch(`${apiUrl}/threads/${threadId}/history`, {
      headers: buildHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: BackendCheckpoint[]) => {
        const first = Array.isArray(data) && data.length > 0 ? data[0] : null;
        setValues({
          messages: first?.values?.messages ?? [],
          ui: first?.values?.ui ?? [],
        });
      })
      .catch((err) => console.warn("[useStream] Erro ao buscar histórico:", err));
  }, [apiUrl, threadId, fetchStateHistory, buildHeaders]);

  const submit = useCallback(
    (
      userInput: Record<string, unknown>,
      submitOptions?: { config?: Record<string, unknown> }
    ) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      (async () => {
        try {
          let activeThreadId = threadId;

          // FIX 2: usa a mesma lógica UUID/graph_id ao criar a thread
          if (!activeThreadId) {
            const createRes = await fetch(`${apiUrl}/threads`, {
              method: "POST",
              headers: buildHeaders(),
              body: JSON.stringify({
                metadata: buildThreadMetadata(assistantId),
              }),
              signal: controller.signal,
            });

            if (!createRes.ok) {
              throw new Error(
                `Falha ao criar thread: ${createRes.status} ${createRes.statusText}`
              );
            }

            const newThread: Thread = await createRes.json();
            activeThreadId = newThread.thread_id;
            if (activeThreadId && onThreadId) onThreadId(activeThreadId);
          }

          const body = JSON.stringify({
            input: userInput,
            ...buildThreadMetadata(assistantId), // graph_id ou assistant_id correto
            ...extraBody,
            ...(submitOptions?.config ? { config: submitOptions.config } : {}),
          });

          const res = await fetch(
            `${apiUrl}/threads/${activeThreadId}/runs/stream`,
            {
              method: "POST",
              headers: buildHeaders("text/event-stream"),
              body,
              signal: controller.signal,
            }
          );

          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            throw new Error(
              `Servidor retornou ${res.status}${detail ? `: ${detail}` : ""}`
            );
          }

          const reader = res.body?.getReader();
          if (!reader) throw new Error("Stream sem body");

          const decoder = new TextDecoder();
          let buffer = "";
          let currentEvent = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim();
                continue;
              }
              if (!line.startsWith("data:")) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;

              let parsed: unknown;
              try {
                parsed = JSON.parse(jsonStr);
              } catch {
                continue;
              }

              switch (currentEvent) {
                case "messages/partial": {
                  const msgs = Array.isArray(parsed)
                    ? (parsed as Message[])
                    : [parsed as Message];
                  setValues((prev) => {
                    const updated = [...prev.messages];
                    for (const msg of msgs) {
                      const idx = updated.findIndex((m) => m.id === msg.id);
                      if (idx === -1) updated.push(msg);
                      else updated[idx] = msg;
                    }
                    return { ...prev, messages: updated };
                  });
                  break;
                }
                case "values": {
                  const state = parsed as Partial<StateType>;
                  setValues((prev) => ({
                    messages: state.messages ?? prev.messages,
                    ui: state.ui ?? prev.ui,
                  }));
                  break;
                }
                case "error": {
                  const errPayload = parsed as { error?: string };
                  setError(
                    new Error(errPayload.error ?? "Erro desconhecido no stream")
                  );
                  break;
                }
                case "custom": {
                  const ev = parsed as UIMessage | RemoveUIMessage;
                  if (isUIMessage(ev) || isRemoveUIMessage(ev)) {
                    onCustomEvent?.(ev, { mutate });
                  }
                  break;
                }
                default:
                  break;
              }
              currentEvent = "";
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setIsLoading(false);
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiUrl, apiKey, assistantId, threadId, extraBody, onCustomEvent, onThreadId, mutate, buildHeaders]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const getMessagesMetadata = useCallback(
    (_message: Message): MessageMetadata | undefined => undefined,
    []
  );

  const setBranch = useCallback((_branchId: string) => {}, []);
  const getBranch = useCallback((): string | null => null, []);

  return {
    values,
    submit,
    stop,
    isLoading,
    error,
    threadId,
    messages: values.messages,
    getMessagesMetadata,
    interrupt: null,
    experimental_branchData: undefined,
    setBranch,
    getBranch,
  };
}