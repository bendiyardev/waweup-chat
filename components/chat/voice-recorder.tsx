"use client";

import * as React from "react";
import { Check, Trash2 } from "lucide-react";
import { APP_CONFIG } from "@/lib/config";
import { formatDuration } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";

type RecorderState =
  | { phase: "starting" }
  | { phase: "recording" }
  | { phase: "denied" }
  | { phase: "error" };

/**
 * Minimal voice recorder built on MediaRecorder. Recording stays local until
 * the user confirms; the resulting blob is then encrypted and uploaded like
 * any other attachment.
 */
export function VoiceRecorder({
  onCancel,
  onFinish,
}: {
  onCancel: () => void;
  onFinish: (blob: Blob, durationSeconds: number) => void;
}) {
  const { d } = useI18n();
  const [state, setState] = React.useState<RecorderState>({
    phase: "starting",
  });
  const [elapsed, setElapsed] = React.useState(0);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<BlobPart[]>([]);
  const startedAtRef = React.useRef(0);
  const finishModeRef = React.useRef<"send" | "cancel">("cancel");

  const cleanup = React.useCallback(() => {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    finishModeRef.current = "cancel";
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
          .find((t) => MediaRecorder.isTypeSupported(t));
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        recorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          const duration = (Date.now() - startedAtRef.current) / 1000;
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          cleanup();
          if (finishModeRef.current === "send" && blob.size > 0) {
            onFinish(blob, duration);
          }
        };
        startedAtRef.current = Date.now();
        recorder.start(1000);
        setState({ phase: "recording" });
      } catch (error) {
        if (cancelled) return;
        if (
          error instanceof DOMException &&
          (error.name === "NotAllowedError" ||
            error.name === "PermissionDeniedError")
        ) {
          setState({ phase: "denied" });
        } else {
          setState({ phase: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        finishModeRef.current = "cancel";
        recorderRef.current.stop();
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed timer + hard cap.
  React.useEffect(() => {
    if (state.phase !== "recording") return;
    const timer = setInterval(() => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(seconds);
      if (seconds >= APP_CONFIG.maxVoiceSeconds) {
        finishModeRef.current = "send";
        recorderRef.current?.stop();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [state.phase]);

  const stop = (mode: "send" | "cancel") => {
    finishModeRef.current = mode;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      cleanup();
    }
    if (mode === "cancel") onCancel();
  };

  if (state.phase === "denied" || state.phase === "error") {
    return (
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 pb-safe">
        <p className="text-sm text-muted-foreground">
          {state.phase === "denied"
            ? d.recorder.micDenied
            : d.recorder.micUnavailable}
        </p>
        <Button variant="outline" size="sm" onClick={onCancel}>
          {d.common.close}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-3 py-2 pb-safe">
      <Button
        variant="destructive-ghost"
        size="icon"
        aria-label={d.recorder.discard}
        onClick={() => stop("cancel")}
      >
        <Trash2 aria-hidden />
      </Button>
      <div className="flex flex-1 items-center gap-2.5">
        <span className="wg-eq" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </span>
        <span
          className="text-sm tabular-nums text-foreground"
          role="timer"
          aria-label={d.recorder.durationAria}
        >
          {state.phase === "starting"
            ? d.recorder.starting
            : formatDuration(elapsed)}
        </span>
      </div>
      <Button
        size="icon"
        aria-label={d.recorder.sendVoice}
        disabled={state.phase !== "recording"}
        onClick={() => stop("send")}
      >
        <Check aria-hidden />
      </Button>
    </div>
  );
}
