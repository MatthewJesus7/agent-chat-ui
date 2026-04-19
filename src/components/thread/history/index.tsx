"use client";

import { Button } from "@/components/ui/button";
import { useThreads } from "@/providers/Thread";
import { type Thread } from "@/providers/types";
import { useEffect } from "react";
import { useQueryState, parseAsBoolean } from "nuqs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelRightOpen, PanelRightClose } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const THREADS_STORAGE_KEY = "mikrotheos:threads";

function saveThreadToStorage(threadId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    const threads: Thread[] = raw ? JSON.parse(raw) : [];
    if (!threads.find((t) => t.thread_id === threadId)) {
      threads.unshift({
        thread_id: threadId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        values: { messages: [] },
      });
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads));
    }
  } catch {
    // no-op
  }
}

function getThreadLabel(t: Thread): string {
  const messages = t.values?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return t.thread_id;
  const first = messages.find((m: any) => m.role === "user" || m.type === "human");
  if (!first) return t.thread_id;
  const content = first.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find((b: any) => b.type === "text");
    return text?.text ?? t.thread_id;
  }
  return t.thread_id;
}

function ThreadList({
  threads,
  onThreadClick,
}: {
  threads: Thread[];
  onThreadClick?: (threadId: string) => void;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");

  return (
    <div className="flex h-full w-full flex-col items-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
      {threads.length === 0 && (
        <p className="px-4 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
      )}
      {threads.map((t) => (
        <div key={t.thread_id} className="w-full px-1">
          <Button
            variant={t.thread_id === threadId ? "secondary" : "ghost"}
            className="w-[280px] items-start justify-start text-left font-normal"
            onClick={() => {
              onThreadClick?.(t.thread_id);
              if (t.thread_id !== threadId) setThreadId(t.thread_id);
            }}
          >
            <p className="truncate text-ellipsis">{getThreadLabel(t)}</p>
          </Button>
        </div>
      ))}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div className="flex h-full w-full flex-col items-start gap-2 overflow-y-scroll">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-[280px]" />
      ))}
    </div>
  );
}

function ThreadHistoryHeader({
  onToggle,
  isOpen,
}: {
  onToggle: () => void;
  isOpen: boolean;
}) {
  return (
    <div className="flex w-full items-center justify-between px-4 pt-1.5">
      <Button className="hover:bg-gray-100" variant="ghost" onClick={onToggle}>
        {isOpen
          ? <PanelRightOpen className="size-5" />
          : <PanelRightClose className="size-5" />}
      </Button>
      <h1 className="text-xl font-semibold tracking-tight">Histórico</h1>
    </div>
  );
}

export default function ThreadHistory() {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false)
  );
  const [threadId] = useQueryState("threadId");

  const { getThreads, threads, setThreads, threadsLoading, setThreadsLoading } =
    useThreads();

  useEffect(() => {
    // Se tem threadId na URL, garante que está salvo no localStorage
    // antes de carregar a lista — resolve o race condition com onThreadId
    if (threadId) saveThreadToStorage(threadId);

    setThreadsLoading(true);
    getThreads()
      .then((data) => {
        console.log("[ThreadHistory] threads recebidos:", data);
        setThreads(data);
      })
      .catch(console.error)
      .finally(() => setThreadsLoading(false));
  }, [threadId]);

  const toggle = () => setChatHistoryOpen((p) => !p);

  return (
    <>
      {/* Desktop */}
      <div className="shadow-inner-right hidden h-screen w-[300px] shrink-0 flex-col items-start gap-6 border-r border-slate-300 lg:flex lg:flex-col">
        <ThreadHistoryHeader onToggle={toggle} isOpen={!!chatHistoryOpen} />
        {threadsLoading ? <ThreadHistoryLoading /> : <ThreadList threads={threads} />}
      </div>

      {/* Mobile */}
      <div className="lg:hidden">
        <Sheet
          open={!!chatHistoryOpen && !isLargeScreen}
          onOpenChange={(open) => { if (!isLargeScreen) setChatHistoryOpen(open); }}
        >
          <SheetContent side="left" className="flex lg:hidden">
            <SheetHeader><SheetTitle>Histórico</SheetTitle></SheetHeader>
            <ThreadList
              threads={threads}
              onThreadClick={() => setChatHistoryOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}