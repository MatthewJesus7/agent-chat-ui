"use client";

/**
 * stream.tsx — Mikrotheos
 * ─────────────────────────────────────────────────────────────────────────────
 * Correções e adições vs versão anterior:
 *   ✅ Seletor de provider na abertura + botão para trocar a qualquer momento
 *   ✅ provider_name injetado em todo stream via body (backend espera isso)
 *   ✅ Histórico restaurado via backend (/threads/{id}/history via fetchStateHistory)
 *   ✅ Lista de threads via /threads/search (backend, não localStorage)
 *   ✅ provider_name salvo em sessionStorage para sobreviver a navegação
 *   ✅ Providers disponíveis buscados do backend via /info (extensível)
 *   ✅ StreamContextType expõe provider atual e setter
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type Message, type Thread } from "@langchain/langgraph-sdk";
import {
  uiMessageReducer,
  isUIMessage,
  isRemoveUIMessage,
  type UIMessage,
  type RemoveUIMessage,
} from "@langchain/langgraph-sdk/react-ui";
import { useQueryState } from "nuqs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowRight, Cpu, ChevronDown, Check } from "lucide-react";
import { createClient } from "./client";
import { getApiKey } from "@/lib/api-key";
import { validate } from "uuid";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type StateType = { messages: Message[]; ui?: UIMessage[] };

type UpdateType = {
  messages?: Message[] | Message | string;
  ui?: (UIMessage | RemoveUIMessage)[] | UIMessage | RemoveUIMessage;
  context?: Record<string, unknown>;
};

const useTypedStream = useStream<
  StateType,
  { UpdateType: UpdateType; CustomEventType: UIMessage | RemoveUIMessage }
>;

type BaseStreamType = ReturnType<typeof useTypedStream>;

type StreamContextType = BaseStreamType & {
  getThreads: () => Promise<Thread[]>;
  provider: string;
  setProvider: (p: string) => void;
  availableProviders: string[];
};

const StreamContext = createContext<StreamContextType | undefined>(undefined);

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_API_URL = "http://localhost:8000";
const DEFAULT_ASSISTANT_ID = "agent";
const PROVIDER_SESSION_KEY = "mikrotheos:provider";

// Providers padrão — serão sobrescritos pelo que vier do backend se /info retornar
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

/**
 * Busca providers disponíveis do backend via GET /info.
 * O backend retorna { version, graphs, ... } — se no futuro expor providers,
 * basta adicionar ao /info e isso já funciona.
 * Por ora retorna FALLBACK_PROVIDERS.
 */
async function fetchAvailableProviders(apiUrl: string, apiKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["x-api-key"] = apiKey;
    const res = await fetch(`${apiUrl}/info`, { headers });
    if (!res.ok) return FALLBACK_PROVIDERS;
    const data = await res.json();
    // Se o backend expuser providers no futuro: data.providers
    return Array.isArray(data.providers) && data.providers.length > 0
      ? data.providers
      : FALLBACK_PROVIDERS;
  } catch {
    return FALLBACK_PROVIDERS;
  }
}

// ─── ProviderSelector ─────────────────────────────────────────────────────────

interface ProviderSelectorProps {
  providers: string[];
  onSelect: (p: string) => void;
  current?: string;
  inline?: boolean; // true = widget compacto para usar dentro do app
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

  // Tela inicial de seleção
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

  /**
   * Busca threads do backend.
   * Fonte da verdade = /threads/search no servidor (lê threads_db.json).
   */
  const getThreads = useCallback(async (): Promise<Thread[]> => {
    try {
      const client = createClient(apiUrl, apiKey, authScheme);
      return await client.threads.search({
        metadata: getThreadSearchMetadata(assistantId),
        limit: 100,
      });
    } catch (err) {
      console.warn("[StreamSession] Falha ao buscar threads do backend:", err);
      return [];
    }
  }, [apiUrl, assistantId, authScheme, apiKey]);

  // ─── useStream (SDK LangGraph) ────────────────────────────────────────────
  const streamValue = useTypedStream({
    apiUrl,
    apiKey,
    assistantId,
    threadId: threadId ?? null,
    fetchStateHistory: true,

    /**
     * provider_name é injetado em CADA chamada via body.
     * O backend lê body.provider_name com prioridade sobre metadata da thread.
     */
    input: {
      provider_name: provider,
    },

    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => ({
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

  // ─── Verifica status do servidor ─────────────────────────────────────────
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

// ─── StreamProvider (ponto de entrada) ───────────────────────────────────────

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

  // ─── Estado do provider ──────────────────────────────────────────────────
  const [provider, setProviderState] = useState<string>(() => {
    // Tenta restaurar da sessão anterior
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(PROVIDER_SESSION_KEY) ?? "";
    }
    return "";
  });

  const [availableProviders, setAvailableProviders] = useState<string[]>(FALLBACK_PROVIDERS);

  const setProvider = useCallback((p: string) => {
    setProviderState(p);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(PROVIDER_SESSION_KEY, p);
    }
  }, []);

  // Busca providers disponíveis quando a URL estiver definida
  useEffect(() => {
    if (!finalApiUrl) return;
    const apiKey = getApiKey() ?? process.env.NEXT_PUBLIC_API_KEY ?? undefined;
    fetchAvailableProviders(finalApiUrl, apiKey).then(setAvailableProviders);
  }, [finalApiUrl]);

  // ─── Tela de configuração de URL ─────────────────────────────────────────
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
                ((fd.get("assistantId") as string).trim()) || DEFAULT_ASSISTANT_ID
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

  // ─── Tela de seleção de provider (primeira vez ou sem sessão salva) ───────
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (!context) {
    throw new Error("useStreamContext deve ser usado dentro de <StreamProvider>");
  }
  return context;
};

/**
 * Hook de conveniência para acessar o seletor de provider inline.
 * Use onde quiser exibir o botão de troca de provider na UI:
 *
 *   const { ProviderSwitcher } = useProviderSwitcher();
 *   return <header>...<ProviderSwitcher /></header>
 */
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