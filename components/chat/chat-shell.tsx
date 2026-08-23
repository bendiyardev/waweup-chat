"use client";

import * as React from "react";
import { toast } from "sonner";
import { INLINE_PREVIEW_MIME } from "@/lib/config";
import { useI18n } from "@/components/i18n/locale-provider";
import {
  encryptAndUploadFile,
  UploadCancelledError,
} from "@/lib/client/attachments";
import type { MessageKind } from "@/types/message";
import { ChatHeader } from "./chat-header";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { PasswordStaleOverlay } from "./password-stale-overlay";
import { useRoom, type ReplyRef } from "./room-provider";

export interface UploadTask {
  id: string;
  name: string;
  phase: "encrypting" | "uploading" | "failed";
  percent: number;
  cancel: () => void;
  retry: () => void;
  dismiss: () => void;
}

let uploadCounter = 0;

function kindForFile(file: File | Blob, voice: boolean): MessageKind {
  if (voice) return "voice";
  const mime = (file.type || "").toLowerCase();
  if (!INLINE_PREVIEW_MIME.has(mime)) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function ChatShell() {
  const room = useRoom();
  const { d } = useI18n();
  const [uploads, setUploads] = React.useState<UploadTask[]>([]);
  const [replyTo, setReplyTo] = React.useState<ReplyRef | null>(null);

  const updateTask = React.useCallback(
    (id: string, patch: Partial<UploadTask>) => {
      setUploads((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },
    [],
  );

  const removeTask = React.useCallback((id: string) => {
    setUploads((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startUpload = React.useCallback(
    (
      file: File | Blob,
      options: { voice?: boolean; durationSeconds?: number; name?: string },
    ) => {
      const id = `u${++uploadCounter}`;
      const name =
        options.name ??
        (file instanceof File && file.name ? file.name : "attachment");
      const controller = new AbortController();

      const run = async () => {
        try {
          const result = await encryptAndUploadFile(room.roomId, file, {
            voice: options.voice,
            signal: controller.signal,
            onProgress: (p) =>
              updateTask(id, {
                phase: p.phase === "done" ? "uploading" : p.phase,
                percent: p.percent,
              }),
          });
          await room.sendAttachmentMessage(
            kindForFile(file, options.voice ?? false),
            {
              ...result.attachment,
              name,
              mime: file.type || "application/octet-stream",
              ...(options.durationSeconds
                ? { durationSeconds: Math.round(options.durationSeconds) }
                : {}),
            },
            result.keyEpoch,
          );
          removeTask(id);
        } catch (error) {
          if (error instanceof UploadCancelledError) {
            removeTask(id);
            return;
          }
          updateTask(id, { phase: "failed" });
        }
      };

      const task: UploadTask = {
        id,
        name,
        phase: "encrypting",
        percent: 0,
        cancel: () => controller.abort(),
        retry: () => {
          updateTask(id, { phase: "encrypting", percent: 0 });
          void run();
        },
        dismiss: () => removeTask(id),
      };
      setUploads((prev) => [...prev, task]);
      void run();
    },
    [room, updateTask, removeTask],
  );

  const handleFiles = React.useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (file.size === 0) continue;
        try {
          startUpload(file, {});
        } catch {
          toast.error(d.chat.uploadStartFailed);
        }
      }
    },
    [startUpload, d.chat.uploadStartFailed],
  );

  const handleVoice = React.useCallback(
    (blob: Blob, durationSeconds: number) => {
      startUpload(blob, {
        voice: true,
        durationSeconds,
        name: d.chat.voiceMessage,
      });
    },
    [startUpload, d.chat.voiceMessage],
  );

  return (
    <div className="mx-auto flex h-dvh-screen w-full max-w-3xl flex-col bg-background">
      <ChatHeader />
      {room.connection !== "online" ? (
        <div
          role="status"
          className="border-b border-border bg-surface-muted px-4 py-1.5 text-center text-xs text-muted-foreground"
        >
          {room.connection === "connecting"
            ? d.chat.reconnecting
            : d.chat.offline}
        </div>
      ) : null}
      <MessageList uploads={uploads} onReply={setReplyTo} />
      <MessageComposer
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onFiles={handleFiles}
        onVoice={handleVoice}
      />
      {room.passwordStale ? <PasswordStaleOverlay /> : null}
    </div>
  );
}
