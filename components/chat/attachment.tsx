"use client";

import * as React from "react";
import { AudioLines, Download, FileIcon, Play } from "lucide-react";
import { INLINE_PREVIEW_MIME } from "@/lib/config";
import { downloadAndDecryptAttachment } from "@/lib/client/attachments";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { Progress, Spinner } from "@/components/ui/misc";
import { useRoom } from "./room-provider";
import type { AttachmentMeta, MessageKind } from "@/types/message";

const AUTO_PREVIEW_BYTES = 6 * 1024 * 1024;

type LoadState =
  | { phase: "idle" }
  | { phase: "loading"; percent: number }
  | { phase: "ready"; url: string }
  | { phase: "error" };

/**
 * Encrypted attachment renderer. Content is downloaded as ciphertext chunks,
 * decrypted in the worker and shown via an object URL. Only a strict MIME
 * whitelist is previewed inline; everything else (including SVG and HTML) is
 * download-only, rendered as text.
 */
export function AttachmentView({
  attachment,
  keyEpoch,
  kind,
  mine,
}: {
  attachment: AttachmentMeta;
  keyEpoch: number;
  kind: MessageKind;
  mine: boolean;
}) {
  const room = useRoom();
  const { d, fmt } = useI18n();
  const [state, setState] = React.useState<LoadState>({ phase: "idle" });
  const urlRef = React.useRef<string | null>(null);
  const mime = (attachment.mime || "").toLowerCase().split(";")[0] ?? "";
  const previewable = INLINE_PREVIEW_MIME.has(mime);

  // Revoke object URLs on unmount to avoid leaks.
  React.useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const load = React.useCallback(async (): Promise<string | null> => {
    setState({ phase: "loading", percent: 0 });
    try {
      const blob = await downloadAndDecryptAttachment(
        room.roomId,
        attachment,
        keyEpoch,
        {
          onProgress: (percent) => setState({ phase: "loading", percent }),
        },
      );
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setState({ phase: "ready", url });
      return url;
    } catch {
      setState({ phase: "error" });
      return null;
    }
  }, [room.roomId, attachment, keyEpoch]);

  // Small previewable media loads automatically.
  React.useEffect(() => {
    if (
      previewable &&
      attachment.size <= AUTO_PREVIEW_BYTES &&
      state.phase === "idle"
    ) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveFile = async () => {
    let url = state.phase === "ready" ? state.url : null;
    if (!url) url = await load();
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.name || "download";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  if (state.phase === "ready" && previewable) {
    if (mime.startsWith("image/")) {
      return (
        <figure className="max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.url}
            alt={attachment.name}
            className="max-h-72 max-w-full rounded-[10px] object-contain"
          />
          <figcaption className="mt-1 flex items-center justify-between gap-2 text-xs opacity-80">
            <span className="truncate">{attachment.name}</span>
            <button
              type="button"
              onClick={() => void saveFile()}
              aria-label={fmt(d.attachment.downloadAria, {
                name: attachment.name,
              })}
              className="shrink-0 underline underline-offset-2"
            >
              {d.attachment.save}
            </button>
          </figcaption>
        </figure>
      );
    }
    if (mime.startsWith("video/")) {
      return (
        <div className="max-w-full">
          { }
          <video
            src={state.url}
            controls
            playsInline
            className="max-h-72 max-w-full rounded-[10px]"
          />
        </div>
      );
    }
    if (mime.startsWith("audio/")) {
      return (
        <div className="flex min-w-52 flex-col gap-1">
          {kind === "voice" ? (
            <span className="flex items-center gap-1.5 text-xs opacity-80">
              <AudioLines className="size-3.5 text-[#FF6903]" aria-hidden />
              {d.chat.voiceMessage}
              {attachment.durationSeconds
                ? ` · ${formatDuration(attachment.durationSeconds)}`
                : ""}
            </span>
          ) : (
            <span className="truncate text-xs opacity-80">
              {attachment.name}
            </span>
          )}
          { }
          <audio src={state.url} controls className="w-full max-w-64" />
        </div>
      );
    }
  }

  return (
    <div className="flex min-w-48 max-w-full items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
          mine ? "bg-accent-foreground/15" : "bg-surface-muted",
        )}
      >
        {previewable && state.phase === "idle" ? (
          <Play className="size-4" aria-hidden />
        ) : (
          <FileIcon className="size-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{attachment.name}</p>
        <p className="text-xs opacity-70">
          {formatBytes(attachment.size)}
          {state.phase === "error" ? ` · ${d.attachment.cantDecrypt}` : ""}
        </p>
        {state.phase === "loading" ? (
          <Progress
            value={state.percent}
            className={cn("mt-1.5", mine && "bg-accent-foreground/20")}
            label={fmt(d.attachment.downloadProgress, {
              name: attachment.name,
            })}
          />
        ) : null}
      </div>
      {state.phase === "loading" ? (
        <Spinner className={cn(mine && "text-accent-foreground")} />
      ) : (
        <button
          type="button"
          onClick={() =>
            previewable && state.phase === "idle"
              ? void load()
              : void saveFile()
          }
          aria-label={
            previewable && state.phase === "idle"
              ? fmt(d.attachment.loadAria, { name: attachment.name })
              : fmt(d.attachment.downloadAria, { name: attachment.name })
          }
          className="shrink-0 rounded-[8px] p-1.5 opacity-80 hover:opacity-100"
        >
          <Download className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
