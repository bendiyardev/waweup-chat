"use client";

import * as React from "react";
import { Link2, Lock, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { APP_CONFIG } from "@/lib/config";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AdminSheet } from "./admin-sheet";
import { useRoom } from "./room-provider";

export function ChatHeader() {
  const room = useRoom();
  const { d, fmt } = useI18n();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const onlineCount = room.members.filter((m) => m.online).length;

  const copyInvite = async () => {
    // The invite link contains the room URL only — never the password.
    const url = `${window.location.origin}/c/${room.roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(d.chat.inviteCopied, {
        description: d.chat.inviteCopiedDesc,
      });
    } catch {
      toast.error(d.chat.copyLinkFailed);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4 pt-safe">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground">
            {room.roomName ?? d.chat.encryptedRoom}
          </h1>
          <p className="text-xs text-muted-foreground">
            {room.members.length || 1} / {APP_CONFIG.maxMembers}
            {onlineCount > 0
              ? ` · ${fmt(d.chat.online, { n: onlineCount })}`
              : ""}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={d.chat.copyInvite}
              onClick={() => void copyInvite()}
            >
              <Link2 aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{d.chat.copyInvite}</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={d.chat.roomMenu}
          onClick={() => setSheetOpen(true)}
        >
          <MoreHorizontal aria-hidden />
        </Button>
        <AdminSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      </header>
    </TooltipProvider>
  );
}
