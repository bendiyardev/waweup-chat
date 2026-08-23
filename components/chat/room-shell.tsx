"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { useRoom } from "./room-provider";
import { ChatShell } from "./chat-shell";
import { NameScreen } from "./name-screen";
import { StatusScreen } from "./status-screens";
import { UnlockScreen } from "./unlock-screen";
import { Spinner } from "@/components/ui/misc";

export function RoomShell() {
  const room = useRoom();
  const { d } = useI18n();

  if (room.fatal) {
    return <StatusScreen kind={room.fatal} onRetry={room.retryCheck} />;
  }

  switch (room.phase) {
    case "checking":
      return (
        <main className="flex h-dvh-screen flex-col items-center justify-center gap-3">
          <Spinner className="size-5" />
          <p className="text-sm text-muted-foreground">{d.status.checking}</p>
        </main>
      );
    case "password":
      return <UnlockScreen />;
    case "name":
      return <NameScreen />;
    case "ready":
      return <ChatShell />;
  }
}
