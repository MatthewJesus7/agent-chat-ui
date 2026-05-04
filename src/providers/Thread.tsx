"use client";

import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useState,
  useMemo,
  Dispatch,
  SetStateAction,
} from "react";
import { type Thread, type Message } from "./types";

// ─── Constantes ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "llm_router:threads";

// ─── Helpers localStorage ─────────────────────────────────────────────────────

export function loadThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveThreads(threads: Thread[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

export function upsertThread(thread: Thread): void {
  const threads = loadThreads();
  const idx = threads.findIndex((t) => t.thread_id === thread.thread_id);
  if (idx === -1) {
    threads.unshift(thread); // novo: vai pro topo
  } else {
    threads[idx] = thread;   // existente: atualiza
  }
  saveThreads(threads);
}

export function deleteThread(threadId: string): void {
  saveThreads(loadThreads().filter((t) => t.thread_id !== threadId));
}

/**
 * FIX: Retorna as mensagens de uma thread salva no localStorage.
 * Usado como onLoadHistory no useStream — evita bater no backend stateless.
 */
export function loadThreadMessages(threadId: string): Message[] {
  const thread = loadThreads().find((t) => t.thread_id === threadId);
  return (thread?.values?.messages as Message[]) ?? [];
}

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
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const getThreads = useCallback(async (): Promise<Thread[]> => {
    return loadThreads();
  }, []);

  const contextValue = useMemo(
    () => ({ getThreads, threads, setThreads, threadsLoading, setThreadsLoading }),
    [getThreads, threads, threadsLoading]
  );

  return (
    <ThreadContext.Provider value={contextValue}>
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