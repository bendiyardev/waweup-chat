"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { FatalKind } from "./room-provider";

function copyFor(
  d: Dictionary,
  kind: FatalKind,
): { title: string; body: string } {
  switch (kind) {
    case "not-found":
      return { title: d.status.notFoundTitle, body: d.status.notFoundBody };
    case "gone":
      return { title: d.status.goneTitle, body: d.status.goneBody };
    case "destroyed":
      return { title: d.status.destroyedTitle, body: d.status.destroyedBody };
    case "full":
      return { title: d.status.fullTitle, body: d.status.fullBody };
    case "banned":
      return { title: d.status.bannedTitle, body: d.status.bannedBody };
    case "locked":
      return { title: d.status.lockedTitle, body: d.status.lockedBody };
    case "removed":
      return { title: d.status.removedTitle, body: d.status.removedBody };
    case "network":
      return { title: d.status.networkTitle, body: d.status.networkBody };
  }
}

export function StatusScreen({
  kind,
  onRetry,
}: {
  kind: FatalKind;
  onRetry?: () => void;
}) {
  const { d } = useI18n();
  const copy = copyFor(d, kind);
  return (
    <main className="flex h-dvh-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">{copy.title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{copy.body}</p>
      <div className="mt-2 flex items-center gap-3">
        {kind === "network" && onRetry ? (
          <Button onClick={onRetry}>{d.status.tryAgain}</Button>
        ) : null}
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {d.status.createNew}
        </Link>
      </div>
    </main>
  );
}
