"use client";

import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useState,
  Dispatch,
  SetStateAction,
} from "react";
import { getApiKey } from "@/lib/api-key";
import { buildThreadMetadata, type Thread } from "./types";

// ─── Contexto ─────────────────────────────────────────────────────────────────

interface ThreadContextType {
  getThreads: () => Promise<Thread[]>;
  threads: Thread[];
  setThreads: Dispatch<SetStateAction<Thread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThreadProvider({ children }: { children: ReactNode }) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  const assistantId = process.env.NEXT_PUBLIC_ASSISTANT_ID ?? "";
  const apiKey = getApiKey() ?? process.env.NEXT_PUBLIC_API_KEY ?? undefined;
  const authScheme = process.env.NEXT_PUBLIC_AUTH_SCHEME ?? "";

  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const getThreads = useCallback(async (): Promise<Thread[]> => {
    if (!apiUrl || !assistantId) return [];

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["x-api-key"] = apiKey;
    if (authScheme) headers["Authorization"] = `${authScheme} ${apiKey ?? ""}`;

    try {
      const res = await fetch(`${apiUrl}/threads/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: buildThreadMetadata(assistantId),
          limit: 100,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Thread[];
    } catch (err) {
      console.warn("[ThreadProvider] Falha ao buscar threads:", err);
      return [];
    }
  }, [apiUrl, assistantId, apiKey, authScheme]);

  return (
    <ThreadContext.Provider
      value={{ getThreads, threads, setThreads, threadsLoading, setThreadsLoading }}
    >
      {children}
    </ThreadContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useThreads() {
  const context = useContext(ThreadContext);
  if (!context) {
    throw new Error("useThreads deve ser usado dentro de <ThreadProvider>");
  }
  return context;
}