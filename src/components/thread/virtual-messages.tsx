"use client";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { AIMessage } from "./messages/ai";
import { HumanMessage } from "./messages/human";
import { Message } from "@/providers/types";

interface VirtualMessagesProps {
  messages: Message[];
  isStreaming: boolean;
}

const Row = ({ index, style, data }: { index: number; style: any; data: any }) => {
  const { messages, isStreaming } = data;
  const msg = messages[index];
  return (
    <div style={style}>
      {msg.role === "user" ? (
        <HumanMessage message={msg} />
      ) : (
        <AIMessage message={msg} isStreaming={isStreaming && index === messages.length - 1} />
      )}
    </div>
  );
};

export function VirtualMessages({ messages, isStreaming }: VirtualMessagesProps) {
  return (
    <AutoSizer>
      {({ height, width }) => (
        <List
          height={height}
          width={width}
          itemCount={messages.length}
          itemSize={100}  // Ajusta por msg height avg
          itemData={{ messages, isStreaming }}
          overscanCount={5}
        >
          {Row}
        </List>
      )}
    </AutoSizer>
  );
}
