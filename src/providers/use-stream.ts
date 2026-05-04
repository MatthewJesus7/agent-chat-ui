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
  /**
   * FIX: Callback para o pai fornecer histórico do localStorage ao trocar de thread.
   * Evita bater no backend stateless e garante que as mensagens apareçam.
   */
  onLoadHistory?: (threadId: string) => Message[];
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
    onLoadHistory,
    onCustomEvent,
    onThreadId,
  } = options;

  const [values, setValues] = useState<StateType>(EMPTY_STATE);
  const valuesRef = useRef<StateType>(EMPTY_STATE);
  useEffect(() => { valuesRef.current = values; }, [values]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevThreadIdRef = useRef<string | null>(null);
  /**
   * FIX: Guarda o ID da thread recém-criada pelo submit.
   * Impede que o useEffect limpe o estado enquanto o stream ainda está rodando.
   */
  const justCreatedThreadRef = useRef<string | null>(null);

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

  /**
   * FIX: useEffect reescrito para 3 cenários distintos:
   * 1. Thread nula → limpa estado
   * 2. Thread recém-criada pelo submit → NÃO limpa, NÃO busca (stream está ativo)
   * 3. Troca real de thread → limpa + carrega do localStorage via onLoadHistory
   */
  useEffect(() => {
    const threadChanged = threadId !== prevThreadIdRef.current;
    prevThreadIdRef.current = threadId;

    if (!threadId) {
      setValues(EMPTY_STATE);
      return;
    }

    if (!threadChanged) return;

    // Cenário 2: submit acabou de criar essa thread — não interfere
    if (justCreatedThreadRef.current === threadId) {
      justCreatedThreadRef.current = null;
      return;
    }

    // Cenário 3: usuário clicou em outra thread
    setValues(EMPTY_STATE);

    // Tenta carregar do localStorage via callback do pai (fonte de verdade)
    if (onLoadHistory) {
      const cached = onLoadHistory(threadId);
      if (cached.length > 0) {
        setValues({ messages: cached, ui: [] });
        return; // localStorage tem os dados — não precisa do backend
      }
    }

    // Fallback: tenta buscar no backend (útil só se backend tiver estado real)
    if (!fetchStateHistory) return;

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
  }, [apiUrl, threadId, fetchStateHistory, buildHeaders, onLoadHistory]);

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

          if (!activeThreadId) {
            // FIX: extrai label da primeira mensagem humana para exibir na sidebar
            const newMsgs = (userInput.messages as Message[]) ?? [];
            const firstHuman = newMsgs.find(
              (m) =>
                (m as any).type === "human" || (m as any).role === "user"
            );
            const rawContent = firstHuman?.content;
            const label =
              typeof rawContent === "string"
                ? rawContent.slice(0, 60)
                : Array.isArray(rawContent)
                ? (rawContent.find((b: any) => b.type === "text")?.text ?? "").slice(0, 60)
                : "Nova conversa";

            const createRes = await fetch(`${apiUrl}/threads`, {
              method: "POST",
              headers: buildHeaders(),
              body: JSON.stringify({
                metadata: {
                  ...buildThreadMetadata(assistantId),
                  label, // FIX: label salvo para getThreadLabel na sidebar
                },
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

            // FIX: marca ANTES de chamar onThreadId para que o useEffect não limpe
            justCreatedThreadRef.current = activeThreadId;
            if (activeThreadId && onThreadId) onThreadId(activeThreadId);
          }

          // FIX CRÍTICO: manda histórico completo + nova mensagem para o backend
          // O backend é stateless — precisa receber tudo a cada requisição
          const currentHistory = valuesRef.current.messages ?? [];
          const newMsgs = (userInput.messages as Message[]) ?? [];

          const body = JSON.stringify({
            input: {
              ...userInput,
              messages: [...currentHistory, ...newMsgs],
            },
            ...buildThreadMetadata(assistantId),
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
    // FIX: values adicionado às deps para capturar histórico atual no submit
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiUrl, apiKey, assistantId, threadId, extraBody, onCustomEvent, onThreadId, mutate, buildHeaders, onLoadHistory]
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