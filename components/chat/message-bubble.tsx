"use client";

import * as React from "react";
import { AlertCircle, Copy, CornerUpLeft, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatTime } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { Avatar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AttachmentView } from "./attachment";
import { useRoom, type ChatMessage, type ReplyRef } from "./room-provider";

const URL_REGEX = /(https?:\/\/[^\s<>"')]+)/g;

/** Renders text as plain React nodes; only http(s) links become anchors. */
function renderText(text: string): React.ReactNode[] {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function systemText(
  d: Dictionary,
  fmt: (t: string, v?: Record<string, string | number>) => string,
  message: ChatMessage,
): string {
  const payload = message.payload;
  if (!payload?.system) return "";
  const name = payload.displayName;
  const subject = payload.system.subject;
  switch (payload.system.type) {
    case "joined":
      return fmt(d.system.joined, { name });
    case "left":
      return fmt(d.system.left, { name });
    case "removed":
      return subject
        ? fmt(d.system.removed, { name: subject })
        : d.system.removedGeneric;
    case "banned":
      return subject
        ? fmt(d.system.banned, { name: subject })
        : d.system.bannedGeneric;
    case "password-changed":
      return d.system.passwordChanged;
    case "key-rotated":
      return d.system.keyRotated;
    case "chat-cleared":
      return fmt(d.system.cleared, { name });
    case "room-locked":
      return d.system.roomLocked;
    case "room-unlocked":
      return d.system.roomUnlocked;
    default:
      return "";
  }
}

export function MessageBubble({
  message,
  previous,
  onReply,
}: {
  message: ChatMessage;
  previous: ChatMessage | null;
  onReply: (reply: ReplyRef) => void;
}) {
  const room = useRoom();
  const { d, fmt, locale } = useI18n();
  const isMine = message.envelope.memberId === room.me?.memberId;
  const isSystem = message.envelope.kind === "system";

  if (isSystem) {
    const text = systemText(d, fmt, message);
    if (!text && !message.decryptFailure) return null;
    return (
      <li className="message-row flex justify-center py-1.5">
        <span className="rounded-full bg-surface-muted px-3 py-1 text-xs text-muted-foreground">
          {message.decryptFailure ? d.chat.sysEvent : text}
        </span>
      </li>
    );
  }

  const showAuthor =
    !isMine &&
    (previous === null ||
      previous.envelope.memberId !== message.envelope.memberId ||
      previous.envelope.kind === "system");
  const name = message.payload?.displayName ?? null;
  const canDelete = isMine || room.me?.role === "owner";
  const textContent = message.payload?.text ?? "";

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      toast.success(d.chat.copied);
    } catch {
      toast.error(d.chat.copyMsgFailed);
    }
  };

  const doDelete = async () => {
    try {
      await room.deleteMessage(message.envelope.messageId);
    } catch {
      toast.error(d.chat.deleteFailed);
    }
  };

  const doReply = () => {
    onReply({
      messageId: message.envelope.messageId,
      displayName: name ?? d.chat.unknown,
      preview:
        textContent.slice(0, 80) ||
        (message.payload?.attachment ? message.payload.attachment.name : ""),
    });
  };

  return (
    <li
      className={cn(
        "message-row group flex w-full gap-2 py-0.5 animate-message-in",
        isMine ? "justify-end" : "justify-start",
      )}
    >
      {!isMine ? (
        <span className="w-8 shrink-0 self-end">
          {showAuthor ? <Avatar name={name} /> : null}
        </span>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 max-w-[78%] flex-col sm:max-w-[70%]",
          isMine ? "items-end" : "items-start",
        )}
      >
        {showAuthor && name ? (
          <span className="mb-0.5 px-1 text-xs font-medium text-muted-foreground">
            {name}
          </span>
        ) : null}
        <div
          className={cn(
            // max-w-full + anywhere-wrapping: a single unbroken 10k-char
            // word must wrap inside the bubble, never overflow the page.
            "relative max-w-full rounded-[14px] border px-3.5 py-2 text-sm",
            isMine
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border bg-surface text-foreground",
            message.status === "pending" && "opacity-60",
            message.status === "failed" && "border-danger/50",
          )}
        >
          {message.payload?.replyTo ? (
            <div
              className={cn(
                "mb-1.5 rounded-[8px] border-l-2 px-2 py-1 text-xs",
                isMine
                  ? "border-accent-foreground/40 bg-accent-foreground/10 text-accent-foreground/90"
                  : "border-border-strong bg-surface-muted text-muted-foreground",
              )}
            >
              <span className="font-medium">
                {message.payload.replyTo.displayName}
              </span>
              <p className="truncate">{message.payload.replyTo.preview}</p>
            </div>
          ) : null}

          {message.decryptFailure ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              {message.decryptFailure === "locked"
                ? d.chat.msgNewerKey
                : d.chat.msgCorrupt}
            </p>
          ) : message.payload?.attachment ? (
            <AttachmentView
              attachment={message.payload.attachment}
              keyEpoch={message.envelope.keyEpoch}
              kind={message.envelope.kind}
              mine={isMine}
            />
          ) : (
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {renderText(textContent)}
            </p>
          )}
        </div>
        <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          {formatTime(message.envelope.createdAt, locale)}
          {message.status === "pending" ? ` · ${d.chat.sending}` : null}
          {message.status === "failed" ? (
            <button
              type="button"
              onClick={() => void room.resend(message.envelope.messageId)}
              className="text-danger underline underline-offset-2"
            >
              {d.chat.failedRetry}
            </button>
          ) : null}
        </span>
      </div>
      {message.status === "sent" && !message.decryptFailure ? (
        <div
          className={cn(
            "self-center opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100",
            isMine ? "order-first" : "",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={d.chat.msgActions}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isMine ? "end" : "start"}>
              <DropdownMenuItem onSelect={doReply}>
                <CornerUpLeft aria-hidden /> {d.chat.reply}
              </DropdownMenuItem>
              {textContent ? (
                <DropdownMenuItem onSelect={() => void doCopy()}>
                  <Copy aria-hidden /> {d.chat.copyMsg}
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem destructive onSelect={() => void doDelete()}>
                  <Trash2 aria-hidden /> {d.chat.deleteMsg}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </li>
  );
}
