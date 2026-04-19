"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowRight, Cpu, ChevronDown, Check } from "lucide-react";
import { getApiKey } from "@/lib/api-key";
import { toast } from "sonner";
import { useStream, type UseStreamReturn } from "./use-stream";
import {
  isUIMessage,
  isRemoveUIMessage,
  uiMessageReducer,
  type Thread,
  type UIMessage,
  type RemoveUIMessage,
} from "./types";

// ─── useQueryState ────────────────────────────────────────────────────────────

function useQueryState(
  key: string,
  options?: { defaultValue?: string }
): [string, (value: string | null) => void] {
  const getParam = (): string => {
    if (typeof window === "undefined") return options?.defaultValue ?? "";
    return (
      new URLSearchParams(window.location.search).get(key) ??
      options?.defaultValue ??
      ""
    );
  };

  const [value, setValueState] = useState<string>(getParam);

  useEffect(() => {
    const handler = () => setValueState(getParam());
    window.addEventListener("popstate", handler);
    const originalPush = window.history.pushState.bind(window.history);
    window.history.pushState = (...args) => {
      originalPush(...args);
      window.dispatchEvent(new Event("locationchange"));
    };
    window.addEventListener("locationchange", handler);
    return () => {
      window.removeEventListener("popstate", handler);
      window.removeEventListener("locationchange", handler);
    };
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
      window.history.pushState(
        {},
        "",
        window.location.pathname + (search ? `?${search}` : "") + window.location.hash
      );
      setValueState(newValue ?? options?.defaultValue ?? "");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  return [value, setValue];
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_API_URL = "http://localhost:8000";
const DEFAULT_ASSISTANT_ID = "agent";
const PROVIDER_SESSION_KEY = "mikrotheos:provider";
const THREADS_STORAGE_KEY = "mikrotheos:threads";
const FALLBACK_PROVIDERS = ["Grok", "venice", "glm-4.7-flash-heretic"];

// ─── Helpers localStorage ─────────────────────────────────────────────────────

function loadThreadsFromStorage(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function upsertThreadInStorage(threadId: string): void {
  if (typeof window === "undefined") return;
  const threads = loadThreadsFromStorage();
  const exists = threads.find((t) => t.thread_id === threadId);
  if (!exists) {
    threads.unshift({
      thread_id: threadId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      values: { messages: [] },
    });
    localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads));
  }
}

// ─── Helpers servidor ─────────────────────────────────────────────────────────

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
    if (!res.ok) {
      console.warn(`[providers] /info retornou ${res.status}, usando fallback`);
      return FALLBACK_PROVIDERS;
    }
    const data = await res.json();
    if (Array.isArray(data.providers) && data.providers.length > 0) {
      return data.providers as string[];
    }
    console.info("[providers] /info não retornou providers, usando fallback");
    return FALLBACK_PROVIDERS;
  } catch (err) {
    console.warn("[providers] Falha ao buscar /info:", err, "usando fallback");
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
                onClick={() => { onSelect(p); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              >
                {p === current
                  ? <Check className="h-3.5 w-3.5 text-primary" />
                  : <span className="w-3.5" />}
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

// ─── ProviderSwitcher (fora do hook — evita recriar a cada render) ─────────────

const ProviderSwitcherComponent: React.FC = () => {
  const { provider, setProvider, availableProviders } = useStreamContext();
  return (
    <ProviderSelector
      providers={availableProviders}
      onSelect={setProvider}
      current={provider}
      inline
    />
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

  // ← lê do localStorage, não do backend
  const getThreads = useCallback(async (): Promise<Thread[]> => {
    return loadThreadsFromStorage();
  }, []);

  const streamValue = useStream({
    apiUrl,
    apiKey,
    assistantId,
    threadId: threadId || null,
    fetchStateHistory: true,
    extraBody: provider ? { provider_name: provider } : undefined,
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
      upsertThreadInStorage(id); // ← salva no localStorage
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

export const StreamProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const envAssistantId = process.env.NEXT_PUBLIC_ASSISTANT_ID;
  const envAuthScheme = process.env.NEXT_PUBLIC_AUTH_SCHEME;

  const [apiUrl, setApiUrl] = useQueryState("apiUrl", { defaultValue: envApiUrl || "" });
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [authScheme] = useQueryState("authScheme", { defaultValue: envAuthScheme || "" });

  const finalApiUrl = apiUrl || envApiUrl;
  const finalAssistantId = assistantId || envAssistantId;

  const [provider, setProviderState] = useState<string>("");
  const [availableProviders, setAvailableProviders] = useState<string[]>(FALLBACK_PROVIDERS);

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
              setAssistantId(((fd.get("assistantId") as string).trim()) || DEFAULT_ASSISTANT_ID);
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

  if (!provider) {
    return <ProviderSelector providers={availableProviders} onSelect={setProvider} />;
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
    throw new Error("useStreamContext deve ser usado dentro de <StreamProvider>");
  }
  return context;
};

export const useProviderSwitcher = () => {
  const { provider, setProvider } = useStreamContext();
  return { provider, setProvider, ProviderSwitcher: ProviderSwitcherComponent };
};

export default StreamContext;