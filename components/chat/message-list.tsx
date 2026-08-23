"use client";

import * as React from "react";
import { ArrowDown, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Progress, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./message-bubble";
import type { UploadTask } from "./chat-shell";
import { useRoom, type ReplyRef } from "./room-provider";

export function MessageList({
  uploads,
  onReply,
}: {
  uploads: UploadTask[];
  onReply: (reply: ReplyRef) => void;
}) {
  const room = useRoom();
  const { d, fmt, plural } = useI18n();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const topSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const nearBottomRef = React.useRef(true);
  const [newCount, setNewCount] = React.useState(0);
  const prevLastIdRef = React.useRef<string | null>(null);
  const prevFirstIdRef = React.useRef<string | null>(null);

  const scrollToBottom = React.useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  }, []);

  // Track whether the reader is near the bottom.
  const handleScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < 120;
    if (nearBottomRef.current) setNewCount(0);
  }, []);

  // Autoscroll on new messages only when already at the bottom.
  React.useEffect(() => {
    const last = room.messages[room.messages.length - 1];
    const lastId = last?.envelope.messageId ?? null;
    const first = room.messages[0];
    const firstId = first?.envelope.messageId ?? null;

    const appended =
      lastId !== null &&
      prevLastIdRef.current !== null &&
      lastId !== prevLastIdRef.current;
    const initial = prevLastIdRef.current === null && lastId !== null;
    const prepended =
      firstId !== null &&
      prevFirstIdRef.current !== null &&
      firstId !== prevFirstIdRef.current &&
      lastId === prevLastIdRef.current;

    prevLastIdRef.current = lastId;
    prevFirstIdRef.current = firstId;

    if (initial) {
      requestAnimationFrame(() => scrollToBottom());
      return;
    }
    if (prepended) return; // older history loaded — keep position
    if (appended) {
      const mine = last?.envelope.memberId === room.me?.memberId;
      if (nearBottomRef.current || mine) {
        requestAnimationFrame(() => scrollToBottom(true));
      } else {
        setNewCount((n) => n + 1);
      }
    }
  }, [room.messages, room.me?.memberId, scrollToBottom]);

  // Load older history when the top sentinel becomes visible.
  React.useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = containerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && room.hasMore && !room.loadingOlder) {
          const prevHeight = container.scrollHeight;
          void room.loadOlder().then(() => {
            // Preserve the reading position after prepending.
            requestAnimationFrame(() => {
              container.scrollTop +=
                container.scrollHeight - prevHeight;
            });
          });
        }
      },
      { root: container, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [room]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-4"
      >
        <div ref={topSentinelRef} aria-hidden />
        {room.loadingOlder ? (
          <div className="flex justify-center py-2">
            <Spinner />
          </div>
        ) : null}
        {room.messages.length === 0 && uploads.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-sm font-medium text-foreground">
              {d.chat.emptyTitle}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {d.chat.emptyBody}
            </p>
          </div>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {room.messages.map((message, index) => (
              <MessageBubble
                key={message.envelope.messageId}
                message={message}
                previous={room.messages[index - 1] ?? null}
                onReply={onReply}
              />
            ))}
          </ol>
        )}
        {uploads.length > 0 ? (
          <div className="mt-2 flex flex-col items-end gap-2">
            {uploads.map((task) => (
              <div
                key={task.id}
                className="w-64 max-w-full rounded-[12px] border border-border bg-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-foreground">
                    {task.name}
                  </p>
                  {task.phase === "failed" ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={d.chat.retryUpload}
                        onClick={task.retry}
                      >
                        <RotateCcw aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={d.chat.dismissUpload}
                        onClick={task.dismiss}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={d.chat.cancelUpload}
                      onClick={task.cancel}
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </div>
                {task.phase === "failed" ? (
                  <p className="mt-1 text-xs text-danger">
                    {d.chat.uploadFailed}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {task.phase === "encrypting"
                        ? d.chat.encrypting
                        : d.chat.uploading}{" "}
                      {task.percent}%
                    </p>
                    <Progress
                      value={task.percent}
                      className="mt-2"
                      label={fmt(d.attachment.uploadProgress, {
                        name: task.name,
                      })}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {room.typingNames.length > 0 ? (
          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span aria-hidden className="flex gap-0.5">
              <span className="typing-dot">●</span>
              <span className="typing-dot">●</span>
              <span className="typing-dot">●</span>
            </span>
            {fmt(
              room.typingNames.length === 1
                ? d.chat.typingOne
                : d.chat.typingMany,
              { names: room.typingNames.join(", ") },
            )}
            …
          </div>
        ) : null}
        <div ref={bottomRef} aria-hidden />
      </div>
      {newCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setNewCount(0);
            scrollToBottom(true);
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-sm"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          {plural(newCount, d.chat.newMessages)}
        </button>
      ) : null}
    </div>
  );
}
