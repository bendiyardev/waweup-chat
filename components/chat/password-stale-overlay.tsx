"use client";

import * as React from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { useRoom } from "./room-provider";

/**
 * Shown when the room password changed while this member still holds keys
 * derived from the old password. History stays readable; new messages need
 * the new password.
 */
export function PasswordStaleOverlay() {
  const room = useRoom();
  const { d } = useI18n();
  const [password, setPassword] = React.useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || room.unlockBusy) return;
    void room.unlock(password);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-[14px] border border-border bg-surface p-5 animate-fade-in">
        <h2 className="text-base font-semibold text-foreground">
          {d.staleOverlay.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {d.staleOverlay.body}
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <Field
            label={d.staleOverlay.newPassword}
            htmlFor="stale-password"
            error={
              room.unlockError === "invalid-password"
                ? d.unlockScreen.errInvalidPassword
                : room.unlockError
                  ? d.unlockScreen.errGeneric
                  : undefined
            }
          >
            <Input
              id="stale-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!password || room.unlockBusy}>
            {room.unlockBusy ? (
              <>
                <Spinner className="text-accent-foreground" />{" "}
                {d.unlockScreen.unlocking}
              </>
            ) : (
              d.staleOverlay.unlock
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
