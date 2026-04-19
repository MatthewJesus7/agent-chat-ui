import { v4 as uuidv4 } from "uuid";
import { ReactNode, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStreamContext } from "@/providers/Stream";
import { FormEvent } from "react";
import { Button } from "../ui/button";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import { AssistantMessage, AssistantMessageLoading } from "./messages/ai";
import { HumanMessage } from "./messages/human";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import { TooltipIconButton } from "./tooltip-icon-button";
import {
  ArrowDown,
  LoaderCircle,
  PanelRightOpen,
  PanelRightClose,
  SquarePen,
  XIcon,
  Plus,
  Moon,
  Sun,
  Settings2,
  Eye,
  EyeOff,
  Cpu,
  Paperclip,
} from "lucide-react";
import { useQueryState, parseAsBoolean } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Badge } from "../ui/badge";
import { useFileUpload } from "@/hooks/use-file-upload";
import { ContentBlocksPreview } from "./ContentBlocksPreview";
import {
  useArtifactOpen,
  ArtifactContent,
  ArtifactTitle,
  useArtifactContext,
} from "./artifact";
import { useProviderSwitcher } from "@/providers/Stream";

// ─── Dark mode hook ───────────────────────────────────────────────────────────
function useDarkMode() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  };
  return { dark, toggle };
}

// ─── StickyToBottomContent ────────────────────────────────────────────────────
function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();
  return (
    <div
      ref={context.scrollRef}
      style={{ width: "100%", height: "100%" }}
      className={props.className}
    >
      <div ref={context.contentRef} className={props.contentClassName}>
        {props.content}
      </div>
      {props.footer}
    </div>
  );
}

// ─── ScrollToBottom ───────────────────────────────────────────────────────────
function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      variant="outline"
      className={props.className}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
      <span>Scroll to bottom</span>
    </Button>
  );
}

// ─── AppLogo ──────────────────────────────────────────────────────────────────
function AppLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Agent Chat logo"
    >
      <rect width="28" height="28" rx="8" className="fill-foreground/10 dark:fill-foreground/15" />
      <circle cx="14" cy="14" r="5" className="fill-foreground/80" />
      <circle cx="14" cy="14" r="2.5" className="fill-background" />
      <path
        d="M14 4v3M14 21v3M4 14h3M21 14h3"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="stroke-foreground/50"
      />
    </svg>
  );
}

// ─── DarkModeToggle ───────────────────────────────────────────────────────────
function DarkModeToggle() {
  const { dark, toggle } = useDarkMode();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={toggle}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <AnimatePresence mode="wait" initial={false}>
              {dark ? (
                <motion.span
                  key="sun"
                  initial={{ rotate: -90, opacity: 0, scale: 0.7 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 90, opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-center"
                >
                  <Sun className="h-4 w-4" />
                </motion.span>
              ) : (
                <motion.span
                  key="moon"
                  initial={{ rotate: 90, opacity: 0, scale: 0.7 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: -90, opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-center"
                >
                  <Moon className="h-4 w-4" />
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>{dark ? "Light mode" : "Dark mode"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── ProviderSheet ────────────────────────────────────────────────────────────
// Wraps the ProviderSwitcher inside a nice Sheet for mobile/desktop
function ProviderSheet({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setOpen(true)}
              aria-label="Switch AI provider"
            >
              <Cpu className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Switch AI provider</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-left text-base font-semibold">
              AI Provider
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── MobileToolbar ────────────────────────────────────────────────────────────
// Consolidates the 4 cramped items into a clean "+" popover on mobile
function MobileToolbar({
  hideToolCalls,
  setHideToolCalls,
  handleFileUpload,
  providerSwitcher,
}: {
  hideToolCalls: boolean | null;
  setHideToolCalls: (v: boolean) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  providerSwitcher: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full"
          aria-label="More options"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-56 rounded-2xl p-2 shadow-xl"
      >
        <div className="flex flex-col gap-1">
          {/* Hide tool calls */}
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-muted"
            onClick={() => setHideToolCalls(!hideToolCalls)}
          >
            {hideToolCalls ? (
              <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span>{hideToolCalls ? "Show" : "Hide"} tool calls</span>
            {hideToolCalls && (
              <Badge variant="secondary" className="ml-auto text-[10px]">
                ON
              </Badge>
            )}
          </button>

          {/* Upload file */}
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-muted"
            onClick={() => {
              setOpen(false);
              fileRef.current?.click();
            }}
          >
            <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>Attach PDF or image</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            onChange={handleFileUpload}
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            className="hidden"
          />

          <div className="my-1 h-px bg-border" />

          {/* Provider switcher inline */}
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">AI Provider</span>
            <div className="ml-auto">{providerSwitcher}</div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Thread ───────────────────────────────────────────────────────────────────
export function Thread() {
  const { ProviderSwitcher } = useProviderSwitcher();

  const [artifactContext, setArtifactContext] = useArtifactContext();
  const [artifactOpen, closeArtifact] = useArtifactOpen();

  const [threadId, _setThreadId] = useQueryState("threadId");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );
  const [hideToolCalls, setHideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );
  const [input, setInput] = useState("");
  const {
    contentBlocks,
    setContentBlocks,
    handleFileUpload,
    dropRef,
    removeBlock,
    dragOver,
    handlePaste,
  } = useFileUpload();
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 639px)");

  const stream = useStreamContext();
  const messages = stream.messages;
  const isLoading = stream.isLoading;

  const lastError = useRef<string | undefined>(undefined);

  const setThreadId = (id: string | null) => {
    _setThreadId(id);
    closeArtifact();
    setArtifactContext({});
  };

  useEffect(() => {
    if (!stream.error) {
      lastError.current = undefined;
      return;
    }
    try {
      const message = (stream.error as any).message;
      if (!message || lastError.current === message) return;
      lastError.current = message;
      toast.error("An error occurred. Please try again.", {
        description: (
          <p>
            <strong>Error:</strong> <code>{message}</code>
          </p>
        ),
        richColors: true,
        closeButton: true,
      });
    } catch {
      // no-op
    }
  }, [stream.error]);

  const prevMessageLength = useRef(0);
  useEffect(() => {
    if (
      messages.length !== prevMessageLength.current &&
      messages?.length &&
      messages[messages.length - 1].type === "ai"
    ) {
      setFirstTokenReceived(true);
    }
    prevMessageLength.current = messages.length;
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if ((input.trim().length === 0 && contentBlocks.length === 0) || isLoading)
      return;
    setFirstTokenReceived(false);

    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: [
        ...(input.trim().length > 0 ? [{ type: "text", text: input }] : []),
        ...contentBlocks,
      ] as Message["content"],
    };

    const toolMessages = ensureToolCallsHaveResponses(stream.messages);
    const context =
      Object.keys(artifactContext).length > 0 ? artifactContext : undefined;

    stream.submit(
      { messages: [...toolMessages, newHumanMessage], context },
      {
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (prev) => ({
          ...prev,
          context,
          messages: [
            ...(prev.messages ?? []),
            ...toolMessages,
            newHumanMessage,
          ],
        }),
      },
    );

    setInput("");
    setContentBlocks([]);
  };

  const handleRegenerate = (
    parentCheckpoint: Checkpoint | null | undefined,
  ) => {
    prevMessageLength.current = prevMessageLength.current - 1;
    setFirstTokenReceived(false);
    stream.submit(undefined, {
      checkpoint: parentCheckpoint,
      streamMode: ["values"],
      streamSubgraphs: true,
      streamResumable: true,
    });
  };

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = !messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground transition-colors duration-300">
      {/* ── Sidebar history ── */}
      <div className="relative hidden lg:flex">
        <motion.div
          className="absolute z-20 h-full overflow-hidden border-r bg-background/95 backdrop-blur-sm"
          style={{ width: 300 }}
          animate={{ x: chatHistoryOpen ? 0 : -300 }}
          initial={{ x: -300 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className="relative h-full" style={{ width: 300 }}>
            <ThreadHistory />
          </div>
        </motion.div>
      </div>

      {/* ── Main layout ── */}
      <div
        className={cn(
          "grid w-full grid-cols-[1fr_0fr] transition-all duration-500",
          artifactOpen && "grid-cols-[3fr_2fr]",
        )}
      >
        <motion.div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-hidden",
            !chatStarted && "grid-rows-[1fr]",
          )}
          layout={isLargeScreen}
          animate={{
            marginLeft: chatHistoryOpen ? (isLargeScreen ? 300 : 0) : 0,
            width: chatHistoryOpen
              ? isLargeScreen
                ? "calc(100% - 300px)"
                : "100%"
              : "100%",
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {/* ── Header (not started) ── */}
          {!chatStarted && (
            <div className="absolute top-0 left-0 z-10 flex w-full items-center justify-between gap-3 p-2 pl-4">
              <div>
                {(!chatHistoryOpen || !isLargeScreen) && (
                  <Button
                    className="hover:bg-accent rounded-full"
                    variant="ghost"
                    size="icon"
                    onClick={() => setChatHistoryOpen((p) => !p)}
                  >
                    {chatHistoryOpen ? (
                      <PanelRightOpen className="size-5" />
                    ) : (
                      <PanelRightClose className="size-5" />
                    )}
                  </Button>
                )}
              </div>
              <div className="absolute top-2 right-4 flex items-center gap-1">
                <DarkModeToggle />
              </div>
            </div>
          )}

          {/* ── Header (chat started) ── */}
          {chatStarted && (
            <div className="relative z-10 flex items-center justify-between gap-3 border-b bg-background/80 px-3 py-2 backdrop-blur-sm">
              <div className="relative flex items-center gap-2">
                {(!chatHistoryOpen || !isLargeScreen) && (
                  <Button
                    className="hover:bg-accent rounded-full"
                    variant="ghost"
                    size="icon"
                    onClick={() => setChatHistoryOpen((p) => !p)}
                  >
                    {chatHistoryOpen ? (
                      <PanelRightOpen className="size-5" />
                    ) : (
                      <PanelRightClose className="size-5" />
                    )}
                  </Button>
                )}
                <motion.button
                  className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-accent"
                  onClick={() => setThreadId(null)}
                  animate={{ marginLeft: !chatHistoryOpen ? 0 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <AppLogo size={24} />
                  <span className="hidden text-base font-semibold tracking-tight sm:block">
                    Agent Chat
                  </span>
                </motion.button>
              </div>

              <div className="flex items-center gap-1">
                <DarkModeToggle />
                <TooltipIconButton
                  size="sm"
                  className="rounded-full"
                  tooltip="New thread"
                  variant="ghost"
                  onClick={() => setThreadId(null)}
                >
                  <SquarePen className="size-4" />
                </TooltipIconButton>
              </div>

              <div className="from-background to-background/0 absolute inset-x-0 top-full h-5 bg-gradient-to-b" />
            </div>
          )}

          {/* ── Messages ── */}
          <StickToBottom className="relative flex-1 overflow-hidden">
            <StickyToBottomContent
              className={cn(
                "absolute inset-0 overflow-y-scroll px-4",
                "[&::-webkit-scrollbar]:w-1.5",
                "[&::-webkit-scrollbar-thumb]:rounded-full",
                "[&::-webkit-scrollbar-thumb]:bg-border",
                "[&::-webkit-scrollbar-track]:bg-transparent",
                !chatStarted && "mt-[25vh] flex flex-col items-stretch",
                chatStarted && "grid grid-rows-[1fr_auto]",
              )}
              contentClassName="pt-8 pb-16 max-w-3xl mx-auto flex flex-col gap-4 w-full"
              content={
                <>
                  {messages
                    .filter((m) => !m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX))
                    .map((message, index) =>
                      message.type === "human" ? (
                        <HumanMessage
                          key={message.id || `${message.type}-${index}`}
                          message={message}
                          isLoading={isLoading}
                        />
                      ) : (
                        <AssistantMessage
                          key={message.id || `${message.type}-${index}`}
                          message={message}
                          isLoading={isLoading}
                          handleRegenerate={handleRegenerate}
                        />
                      ),
                    )}
                  {hasNoAIOrToolMessages && !!stream.interrupt && (
                    <AssistantMessage
                      key="interrupt-msg"
                      message={undefined}
                      isLoading={isLoading}
                      handleRegenerate={handleRegenerate}
                    />
                  )}
                  {isLoading && !firstTokenReceived && (
                    <AssistantMessageLoading />
                  )}
                </>
              }
              footer={
                <div className="sticky bottom-0 flex flex-col items-center gap-6 bg-background/80 backdrop-blur-sm">
                  {/* Welcome header */}
                  {!chatStarted && (
                    <motion.div
                      className="flex flex-col items-center gap-2"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                      <AppLogo size={40} />
                      <h1 className="text-2xl font-semibold tracking-tight">
                        Agent Chat
                      </h1>
                      <p className="text-sm text-muted-foreground">
                        Powered by LangGraph
                      </p>
                    </motion.div>
                  )}

                  <ScrollToBottom className="animate-in fade-in-0 zoom-in-95 absolute bottom-full left-1/2 mb-4 -translate-x-1/2" />

                  {/* ── Input box ── */}
                  <div
                    ref={dropRef}
                    className={cn(
                      "relative z-10 mx-auto mb-6 w-full max-w-3xl rounded-2xl bg-muted/60 shadow-sm ring-1 ring-border/60 transition-all duration-200",
                      dragOver && "ring-2 ring-primary ring-offset-1",
                    )}
                  >
                    <form
                      onSubmit={handleSubmit}
                      className="mx-auto grid max-w-3xl grid-rows-[1fr_auto] gap-2"
                    >
                      <ContentBlocksPreview
                        blocks={contentBlocks}
                        onRemove={removeBlock}
                      />
                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.metaKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            const el = e.target as HTMLElement | undefined;
                            const form = el?.closest("form");
                            form?.requestSubmit();
                          }
                        }}
                        placeholder="Type your message…"
                        className="field-sizing-content resize-none border-none bg-transparent p-3.5 pb-0 shadow-none ring-0 outline-none focus:ring-0 focus:outline-none placeholder:text-muted-foreground/60 text-sm"
                      />

                      {/* ── Toolbar ── */}
                      <div className="flex items-center gap-2 p-2 pt-2">
                        {isMobile ? (
                          /* Mobile: consolidated popover */
                          <MobileToolbar
                            hideToolCalls={hideToolCalls}
                            setHideToolCalls={(v) => setHideToolCalls(v)}
                            handleFileUpload={handleFileUpload}
                            providerSwitcher={<ProviderSwitcher />}
                          />
                        ) : (
                          /* Desktop: inline controls */
                          <>
                            {/* Hide tool calls toggle */}
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setHideToolCalls(!hideToolCalls)
                                    }
                                    className={cn(
                                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                                      hideToolCalls
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-accent",
                                    )}
                                  >
                                    {hideToolCalls ? (
                                      <EyeOff className="h-3.5 w-3.5" />
                                    ) : (
                                      <Eye className="h-3.5 w-3.5" />
                                    )}
                                    <span className="hidden sm:inline">
                                      {hideToolCalls
                                        ? "Tools hidden"
                                        : "Hide tools"}
                                    </span>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  {hideToolCalls
                                    ? "Show tool calls"
                                    : "Hide tool calls"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>

                            {/* File upload */}
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Label
                                    htmlFor="file-input"
                                    className="flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">
                                      Attach
                                    </span>
                                  </Label>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  Attach PDF or image
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <input
                              id="file-input"
                              type="file"
                              onChange={handleFileUpload}
                              multiple
                              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                              className="hidden"
                            />

                            {/* Provider switcher */}
                            <ProviderSwitcher />
                          </>
                        )}

                        {/* Send / Cancel — always rightmost */}
                        <div className="ml-auto">
                          {stream.isLoading ? (
                            <Button
                              key="stop"
                              size="sm"
                              variant="outline"
                              onClick={() => stream.stop()}
                              className="rounded-full"
                            >
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              <span className="hidden sm:inline">Cancel</span>
                            </Button>
                          ) : (
                            <Button
                              type="submit"
                              size="sm"
                              className="rounded-full shadow-sm transition-all"
                              disabled={
                                isLoading ||
                                (!input.trim() && contentBlocks.length === 0)
                              }
                            >
                              Send
                            </Button>
                          )}
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              }
            />
          </StickToBottom>
        </motion.div>

        {/* ── Artifact panel ── */}
        <div className="relative flex flex-col border-l">
          <div className="absolute inset-0 flex min-w-[30vw] flex-col">
            <div className="grid grid-cols-[1fr_auto] border-b bg-background/80 p-4 backdrop-blur-sm">
              <ArtifactTitle className="truncate overflow-hidden text-sm font-medium" />
              <button
                onClick={closeArtifact}
                className="cursor-pointer rounded-full p-1 transition-colors hover:bg-accent"
                aria-label="Close artifact"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <ArtifactContent className="relative flex-grow" />
          </div>
        </div>
      </div>
    </div>
  );
}