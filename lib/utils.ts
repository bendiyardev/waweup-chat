import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTime(iso: string, locale?: string): string {
  try {
    return new Date(iso).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export type ExpiresIn =
  | { kind: "expired" }
  | { kind: "minutes" | "hours" | "days"; n: number };

/** Locale-neutral remaining-time parts; the UI translates the unit. */
export function expiresInParts(expiresAt: string): ExpiresIn {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { kind: "expired" };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { kind: "minutes", n: Math.max(1, minutes) };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { kind: "hours", n: hours };
  return { kind: "days", n: Math.floor(hours / 24) };
}
