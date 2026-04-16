"use client";

/**
 * StreamContext.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * CORREÇÕES vs versão anterior:
 *   ✅ sql.js/SQLite removido — era over-engineering quebrado (WASM, sem wasm file)
 *   ✅ `getThreads` integrado corretamente no contexto (sem hack `as any`)
 *   ✅ `onStateUpdate` removido (não existe no SDK useStream)
 *   ✅ Cache de threads via localStorage (leve, sem dependência extra)
 *   ✅ API key enviada via header x-api-key (compatível com backend)
 *   ✅ StreamContextType tipada com `getThreads`
 *   ✅ Toast de status do servidor simplificado
 *   ✅ Delay no sync de threads reduzido para 1s (era 4s)
 * ─────────────────────────────────────────────────────────────────────────────
 * Segurança (uso pessoal local):
 *   - Defina API_KEY no backend (.env do servidor)
 *   - Defina NEXT_PUBLIC_API_KEY no frontend (.env.local)
 *   - O header x-api-key é injetado automaticamente em toda chamada
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
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
import { ArrowRight, Cpu } from "lucide-react";
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

// useStream tipado
const useTypedStream = useStream<
  StateType,
  { UpdateType: UpdateType; CustomEventType: UIMessage | RemoveUIMessage }
>;

type BaseStreamType = ReturnType<typeof useTypedStream>;

// Contexto estende o retorno do SDK com getThreads
type StreamContextType = BaseStreamType & {
  getThreads: () => Promise<Thread[]>;
};

const StreamContext = createContext<StreamContextType | undefined>(undefined);

// ─── Helpers de metadata ──────────────────────────────────────────────────────

function getThreadSearchMetadata(
  assistantId: string
): { graph_id: string } | { assistant_id: string } {
  return validate(assistantId)
    ? { assistant_id: assistantId }
    : { graph_id: assistantId };
}

// ─── Cache local de threads (localStorage — leve, sem dependência WASM) ───────

const CACHE_KEY = "llm_router:threads";

function getCachedThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Thread[]) : [];
  } catch {
    return [];
  }
}

function setCachedThreads(threads: Thread[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(threads));
  } catch {
    // Ignora se storage cheio ou bloqueado
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

async function checkServerStatus(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/info`);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── StreamSession ────────────────────────────────────────────────────────────

interface StreamSessionProps {
  children: ReactNode;
  apiUrl: string;
  assistantId: string;
  authScheme?: string;
}

const StreamSession: React.FC<StreamSessionProps> = ({
  children,
  apiUrl,
  assistantId,
  authScheme,
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");

  // API key vem do .env.local (NEXT_PUBLIC_API_KEY) ou do mecanismo existente
  const apiKey = getApiKey() ?? process.env.NEXT_PUBLIC_API_KEY ?? undefined;

  /**
   * Busca threads no servidor e atualiza o cache local.
   * Se o servidor estiver offline, retorna o cache.
   */
  const getThreads = useCallback(async (): Promise<Thread[]> => {
    try {
      const client = createClient(apiUrl, apiKey, authScheme);
      const threads = await client.threads.search({
        metadata: getThreadSearchMetadata(assistantId),
        limit: 100,
      });
      setCachedThreads(threads);
      return threads;
    } catch (err) {
      console.warn("[StreamSession] Sync remoto falhou, usando cache local:", err);
      return getCachedThreads();
    }
  }, [apiUrl, assistantId, authScheme, apiKey]);

  // ─── useStream (SDK LangGraph) ───────────────────────────────────────────
  const streamValue = useTypedStream({
    apiUrl,
    apiKey,           // enviado como x-api-key pelo SDK
    assistantId,
    threadId: threadId ?? null,
    fetchStateHistory: true,   // restaura histórico ao recarregar

    // Eventos customizados (UI messages)
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => ({
          ...prev,
          ui: uiMessageReducer(prev.ui ?? [], event),
        }));
      }
    },

    // Nova thread criada pelo SDK → sincroniza lista
    onThreadId: (id) => {
      setThreadId(id);
      // Pequeno delay para o backend persistir antes do sync
      setTimeout(() => {
        getThreads().catch(console.error);
      }, 1000);
    },
  });

  // ─── Verifica status do servidor na montagem ─────────────────────────────
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

  // ─── Monta contexto tipado corretamente ──────────────────────────────────
  const contextValue: StreamContextType = {
    ...streamValue,
    getThreads,
  };

  return (
    <StreamContext.Provider value={contextValue}>
      {children}
    </StreamContext.Provider>
  );
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_API_URL = "http://localhost:8000";
const DEFAULT_ASSISTANT_ID = "agent";

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

  // Tela de configuração inicial (se variáveis de env não estiverem definidas)
  if (!finalApiUrl || !finalAssistantId) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-xl flex-col rounded-lg border shadow-lg">
          <div className="mt-12 flex flex-col gap-2 border-b p-6">
            <div className="flex items-center gap-2">
              <Cpu className="h-6 w-6" />
              <h1 className="text-xl font-semibold tracking-tight">llm_router</h1>
            </div>
            <p className="text-muted-foreground text-sm">
              Informe a URL do servidor para começar.
            </p>
          </div>

          {/* ⚠️ Não usar <form> em React artifacts — aqui é componente Next.js, ok */}
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
              <p className="text-muted-foreground text-xs">
                Endereço onde o backend FastAPI está rodando.
              </p>
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
              <p className="text-muted-foreground text-xs">
                Identificador do grafo configurado no servidor (padrão:{" "}
                <code>agent</code>).
              </p>
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

  return (
    <StreamSession
      apiUrl={finalApiUrl}
      assistantId={finalAssistantId}
      authScheme={authScheme}
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

export default StreamContext;