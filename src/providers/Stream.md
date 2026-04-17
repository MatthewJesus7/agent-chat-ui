"use client";

/**
 * stream.tsx — Mikrotheos
 * ─────────────────────────────────────────────────────────────────────────────
 * CORREÇÕES DE SINCRONIZAÇÃO COM O BACKEND CUSTOMIZADO:
 *
 *   ✅ Endpoint corrigido: /threads/{id}/runs/stream (não mais /runs/stream)
 *   ✅ Thread criada automaticamente via POST /threads antes do primeiro stream
 *   ✅ SSE parsing corrigido: lê linha "event:" para obter o tipo do evento
 *   ✅ Eventos mapeados para os tipos do backend: messages/partial, values, error
 *   ✅ provider_name agora é efetivamente injetado no body do stream
 *   ✅ Body estruturado como { input: userInput, provider_name, assistant_id }
 *   ✅ History parsing corrigido: backend retorna array de checkpoints
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowRight, Cpu, ChevronDown, Check } from "lucide-react";
import { createClient } from "./client";
import { getApiKey } from "@/lib/api-key";
import { validate } from "uuid";
import { toast } from "sonner";

// ─── Tipos locais ─────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  created_at?: string;
}

interface ContentBlock {
  type: "text" | "image_url" | string;
  text?: string;
  image_url?: { url: string };
  [key: string]: unknown;
}

interface ToolCall {
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

// ─── Tipos de UI ──────────────────────────────────────────────────────────────

export interface UIMessage {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface RemoveUIMessage {
  id: string;
  type: "remove";
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

// ─── useQueryState ────────────────────────────────────────────────────────────

function useQueryState(
  key: string,
  options?: { defaultValue?: string }
): [string, (value: string | null) => void] {
  const getParam = (): string => {
    if (typeof window === "undefined") return options?.defaultValue ?? "";
    const params = new URLSearchParams(window.location.search);
    return params.get(key) ?? options?.defaultValue ?? "";
  };

  const [value, setValueState] = useState<string>(getParam);

  useEffect(() => {
    const onPop = () => setValueState(getParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = useCallback(
    (newValue: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (newValue === null || newValue === "") {
        params.delete(key);
      } else {
        params.set(key, newValue);
      }
      const search = params.toString();
      const newUrl =
        window.location.pathname +
        (search ? `?${search}` : "") +
        window.location.hash;
      window.history.pushState({}, "", newUrl);
      setValueState(newValue ?? options?.defaultValue ?? "");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  return [value, setValue];
}

// ─── Tipos do estado ──────────────────────────────────────────────────────────

export interface StateType {
  messages: Message[];
  ui?: UIMessage[];
}

// ─── Formato de checkpoint retornado pelo backend em /history ─────────────────

interface BackendCheckpoint {
  values?: {
    messages?: Message[];
    ui?: UIMessage[];
  };
}

// ─── useStream ────────────────────────────────────────────────────────────────

interface UseStreamOptions {
  apiUrl: string;
  apiKey?: string;
  assistantId: string;
  threadId: string | null;
  fetchStateHistory?: boolean;
  /**
   * Campos extras injetados no body de cada chamada de stream.
   * Ex.: { provider_name: "Grok" }
   */
  extraBody?: Record<string, unknown>;
  onCustomEvent?: (
    event: UIMessage | RemoveUIMessage,
    options: { mutate: (fn: (prev: StateType) => StateType) => void }
  ) => void;
  onThreadId?: (id: string) => void;
}

interface UseStreamReturn {
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
}

function useStream(options: UseStreamOptions): UseStreamReturn {
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

  const [values, setValues] = useState<StateType>({ messages: [], ui: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const mutate = useCallback((fn: (prev: StateType) => StateType) => {
    setValues((prev) => fn(prev));
  }, []);

  // ── Busca histórico ao montar / mudar threadId ───────────────────────────
  useEffect(() => {
    if (!fetchStateHistory || !threadId) return;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["x-api-key"] = apiKey;

    fetch(`${apiUrl}/threads/${threadId}/history`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: BackendCheckpoint[]) => {
        // Backend retorna array de checkpoints; o primeiro tem o estado mais recente
        const first = Array.isArray(data) && data.length > 0 ? data[0] : null;
        setValues({
          messages: first?.values?.messages ?? [],
          ui: first?.values?.ui ?? [],
        });
      })
      .catch((err) => {
        console.warn("[useStream] Erro ao buscar histórico:", err);
      });
  }, [apiUrl, apiKey, threadId, fetchStateHistory]);

  // ── Headers comuns ───────────────────────────────────────────────────────
  const buildHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (apiKey) h["x-api-key"] = apiKey;
    return h;
  }, [apiKey]);

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
          // ── 1. Garante que existe uma thread ─────────────────────────────
          let activeThreadId = threadId;

          if (!activeThreadId) {
            const createRes = await fetch(`${apiUrl}/threads`, {
              method: "POST",
              headers: buildHeaders(),
              body: JSON.stringify({
                metadata: { assistant_id: assistantId },
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

          // ── 2. Monta body para o backend ──────────────────────────────────
          // Estrutura esperada pelo backend:
          //   { input: { messages: [...] }, provider_name: "...", assistant_id: "..." }
          const body = JSON.stringify({
            input: userInput,
            assistant_id: assistantId,
            ...extraBody,
            ...(submitOptions?.config ? { config: submitOptions.config } : {}),
          });

          // ── 3. Abre o stream ──────────────────────────────────────────────
          const res = await fetch(
            `${apiUrl}/threads/${activeThreadId}/runs/stream`,
            {
              method: "POST",
              headers: buildHeaders(),
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

          // ── 4. Lê e processa SSE ──────────────────────────────────────────
          // O backend emite:
          //   event: <tipo>\ndata: <json>\n\n
          //
          // Precisamos rastrear o tipo na linha "event:" ANTES de ler "data:".
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              // Linha de tipo do evento
              if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim();
                continue;
              }

              // Linha de dados
              if (!line.startsWith("data:")) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;

              let parsed: unknown;
              try {
                parsed = JSON.parse(jsonStr);
              } catch {
                continue;
              }

              // ── Despacha pelo tipo de evento do backend ────────────────────
              switch (currentEvent) {
                case "messages/partial": {
                  // Backend envia array de mensagens parciais
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
                  // Estado final da thread após a resposta
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

                // "metadata" e "end" não precisam de tratamento especial
                default:
                  break;
              }

              // Reseta o evento atual após consumir o data
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

  return {
    values,
    submit,
    stop,
    isLoading,
    error,
    threadId,
    messages: values.messages,
  };
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_API_URL = "http://localhost:8000";
const DEFAULT_ASSISTANT_ID = "agent";
const PROVIDER_SESSION_KEY = "mikrotheos:provider";

const FALLBACK_PROVIDERS = ["GoogleAIStudio", "DeepSeek", "Grok", "Venice"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getThreadSearchMetadata(assistantId: string) {
  return validate(assistantId)
    ? { assistant_id: assistantId }
    : { graph_id: assistantId };
}

async function checkServerStatus(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/info`);
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchAvailableProviders(
  apiUrl: string,
  apiKey?: string
): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["x-api-key"] = apiKey;
    const res = await fetch(`${apiUrl}/info`, { headers });
    if (!res.ok) return FALLBACK_PROVIDERS;
    const data = await res.json();
    return Array.isArray(data.providers) && data.providers.length > 0
      ? data.providers
      : FALLBACK_PROVIDERS;
  } catch {
    return FALLBACK_PROVIDERS;
  }
}

// ─── Contexto ─────────────────────────────────────────────────────────────────

type StreamContextType = UseStreamReturn & {
  getThreads: () => Promise<Thread[]>;
  provider: string;
  setProvider: (p: string) => void;
  availableProviders: string[];
};

const StreamContext = createContext<StreamContextType | undefined>(undefined);

// ─── ProviderSelector ─────────────────────────────────────────────────────────

interface ProviderSelectorProps {
  providers: string[];
  onSelect: (p: string) => void;
  current?: string;
  inline?: boolean;
}

const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  providers,
  onSelect,
  current,
  inline = false,
}) => {
  const [open, setOpen] = useState(false);

  if (inline) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-sm font-medium shadow-sm transition hover:bg-muted"
        >
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{current ?? "Selecionar"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border bg-background shadow-lg">
            {providers.map((p) => (
              <button
                key={p}
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              >
                {p === current && <Check className="h-3.5 w-3.5 text-primary" />}
                {p !== current && <span className="w-3.5" />}
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4">
      <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-sm flex-col gap-6 rounded-lg border p-8 shadow-lg">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            <h1 className="text-lg font-semibold tracking-tight">Mikrotheos</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Escolha o modelo de linguagem para esta sessão.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => onSelect(p)}
              className="flex items-center justify-between rounded-md border px-4 py-3 text-sm font-medium transition hover:bg-muted hover:border-primary/40"
            >
              {p}
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── StreamSession ────────────────────────────────────────────────────────────

interface StreamSessionProps {
  children: ReactNode;
  apiUrl: string;
  assistantId: string;
  authScheme?: string;
  provider: string;
  setProvider: (p: string) => void;
  availableProviders: string[];
}

const StreamSession: React.FC<StreamSessionProps> = ({
  children,
  apiUrl,
  assistantId,
  authScheme,
  provider,
  setProvider,
  availableProviders,
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");
  const apiKey = getApiKey() ?? process.env.NEXT_PUBLIC_API_KEY ?? undefined;

  const getThreads = useCallback(async (): Promise<Thread[]> => {
    try {
      const client = createClient(apiUrl, apiKey, authScheme);
        return await client.threads.search({
        metadata: getThreadSearchMetadata(assistantId),
        limit: 100,
      }
    );
    } catch (err) {
      console.warn("[StreamSession] Falha ao buscar threads do backend:", err);
      return [];
    }
  }, [apiUrl, assistantId, authScheme, apiKey]);

  const streamValue = useStream({
    apiUrl,
    apiKey,
    assistantId,
    threadId: threadId || null,
    fetchStateHistory: true,

    // provider_name injetado em cada chamada de stream via extraBody
    extraBody: {
      provider_name: provider,
    },

    onCustomEvent: (event, opts) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        opts.mutate((prev) => ({
          ...prev,
          ui: uiMessageReducer(prev.ui ?? [], event),
        }));
      }
    },

    onThreadId: (id) => {
      setThreadId(id);
      setTimeout(() => {
        getThreads().catch(console.error);
      }, 1000);
    },
  });

  useEffect(() => {
    checkServerStatus(apiUrl).then((ok) => {
      if (!ok) {
        toast.error("Backend inacessível", {
          description: `Verifique se o servidor está rodando em ${apiUrl}`,
          duration: 10_000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiUrl]);

  const contextValue: StreamContextType = {
    ...streamValue,
    getThreads,
    provider,
    setProvider,
    availableProviders,
  };

  return (
    <StreamContext.Provider value={contextValue}>
      {children}
    </StreamContext.Provider>
  );
};

// ─── StreamProvider ───────────────────────────────────────────────────────────

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const envAssistantId = process.env.NEXT_PUBLIC_ASSISTANT_ID;
  const envAuthScheme = process.env.NEXT_PUBLIC_AUTH_SCHEME;

  const [apiUrl, setApiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [authScheme] = useQueryState("authScheme", {
    defaultValue: envAuthScheme || "",
  });

  const finalApiUrl = apiUrl || envApiUrl;
  const finalAssistantId = assistantId || envAssistantId;

  const [provider, setProviderState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(PROVIDER_SESSION_KEY) ?? "";
    }
    return "";
  });

  const [availableProviders, setAvailableProviders] =
    useState<string[]>(FALLBACK_PROVIDERS);

  const setProvider = useCallback((p: string) => {
    setProviderState(p);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(PROVIDER_SESSION_KEY, p);
    }
  }, []);

  useEffect(() => {
    if (!finalApiUrl) return;
    const apiKey = getApiKey() ?? process.env.NEXT_PUBLIC_API_KEY ?? undefined;
    fetchAvailableProviders(finalApiUrl, apiKey).then(setAvailableProviders);
  }, [finalApiUrl]);

  // ── Tela de configuração de URL ─────────────────────────────────────────
  if (!finalApiUrl || !finalAssistantId) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-xl flex-col rounded-lg border shadow-lg">
          <div className="mt-12 flex flex-col gap-2 border-b p-6">
            <div className="flex items-center gap-2">
              <Cpu className="h-6 w-6" />
              <h1 className="text-xl font-semibold tracking-tight">Mikrotheos</h1>
            </div>
            <p className="text-muted-foreground text-sm">
              Informe a URL do servidor para começar.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.target as HTMLFormElement);
              setApiUrl((fd.get("apiUrl") as string).trim());
              setAssistantId(
                ((fd.get("assistantId") as string).trim()) ||
                  DEFAULT_ASSISTANT_ID
              );
              (e.target as HTMLFormElement).reset();
            }}
            className="bg-muted/50 flex flex-col gap-5 p-6"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="apiUrl">
                URL do servidor <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="apiUrl"
                name="apiUrl"
                className="bg-background"
                defaultValue={apiUrl || DEFAULT_API_URL}
                placeholder="http://localhost:8000"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="assistantId">
                Graph ID <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="assistantId"
                name="assistantId"
                className="bg-background"
                defaultValue={assistantId || DEFAULT_ASSISTANT_ID}
                placeholder="agent"
                required
              />
            </div>

            <div className="mt-1 flex justify-end">
              <Button type="submit" size="lg">
                Conectar <ArrowRight className="ml-1 size-4" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── Tela de seleção de provider ─────────────────────────────────────────
  if (!provider) {
    return (
      <ProviderSelector
        providers={availableProviders}
        onSelect={setProvider}
      />
    );
  }

  return (
    <StreamSession
      apiUrl={finalApiUrl}
      assistantId={finalAssistantId}
      authScheme={authScheme ?? undefined}
      provider={provider}
      setProvider={setProvider}
      availableProviders={availableProviders}
    >
      {children}
    </StreamSession>
  );
};

// ─── Hooks públicos ───────────────────────────────────────────────────────────

export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (!context) {
    throw new Error(
      "useStreamContext deve ser usado dentro de <StreamProvider>"
    );
  }
  return context;
};

export const useProviderSwitcher = () => {
  const { provider, setProvider, availableProviders } = useStreamContext();

  const ProviderSwitcher: React.FC = () => (
    <ProviderSelector
      providers={availableProviders}
      onSelect={setProvider}
      current={provider}
      inline
    />
  );

  return { provider, setProvider, ProviderSwitcher };
};

export default StreamContext;