"use client";

import * as React from "react";
import { Mic, Plus, SendHorizontal, X } from "lucide-react";
import { APP_CONFIG } from "@/lib/config";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { VoiceRecorder } from "./voice-recorder";
import { useRoom, type ReplyRef } from "./room-provider";

export function MessageComposer({
  replyTo,
  onClearReply,
  onFiles,
  onVoice,
}: {
  replyTo: ReplyRef | null;
  onClearReply: () => void;
  onFiles: (files: FileList) => void;
  onVoice: (blob: Blob, durationSeconds: number) => void;
}) {
  const room = useRoom();
  const { d } = useI18n();
  const [text, setText] = React.useState("");
  const [recording, setRecording] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const composingRef = React.useRef(false);
  const coarsePointerRef = React.useRef(false);

  React.useEffect(() => {
    coarsePointerRef.current =
      window.matchMedia?.("(pointer: coarse)").matches ?? false;
  }, []);

  const autogrow = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // ~5 lines cap.
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, []);

  const doSend = React.useCallback(() => {
    const value = text.trim();
    if (!value) return;
    setText("");
    onClearReply();
    requestAnimationFrame(autogrow);
    void room.sendText(value, replyTo ?? undefined);
  }, [text, room, replyTo, onClearReply, autogrow]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    // Respect IME composition and keep Enter natural on touch keyboards.
    if (composingRef.current || event.nativeEvent.isComposing) return;
    if (coarsePointerRef.current) return;
    if (event.shiftKey) return;
    event.preventDefault();
    doSend();
  };

  if (recording) {
    return (
      <VoiceRecorder
        onCancel={() => setRecording(false)}
        onFinish={(blob, duration) => {
          setRecording(false);
          onVoice(blob, duration);
        }}
      />
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface px-2 pb-safe sm:px-3">
      {replyTo ? (
        <div className="mx-1 mt-2 flex items-center justify-between gap-2 rounded-[10px] border border-border bg-surface-muted px-3 py-1.5">
          <p className="min-w-0 text-xs text-muted-foreground">
            {d.chat.replyingTo}{" "}
            <span className="font-medium text-foreground">
              {replyTo.displayName}
            </span>
            <span className="ml-1.5 truncate">{replyTo.preview}</span>
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={d.chat.cancelReply}
            onClick={onClearReply}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}
      <div className="flex items-end gap-1.5 py-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFiles(e.target.files);
            }
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={d.chat.attachFile}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus aria-hidden />
        </Button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          maxLength={APP_CONFIG.maxTextLength}
          placeholder={d.chat.messagePlaceholder}
          aria-label={d.chat.messageAria}
          onChange={(e) => {
            setText(e.target.value);
            autogrow();
            room.notifyTyping();
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          className="max-h-[132px] min-h-11 flex-1 resize-none rounded-[12px] border border-border bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none md:text-sm"
        />
        {text.trim() ? (
          <Button size="icon" aria-label={d.chat.send} onClick={doSend}>
            <SendHorizontal aria-hidden />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={d.chat.recordVoice}
            onClick={() => setRecording(true)}
          >
            <Mic aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
