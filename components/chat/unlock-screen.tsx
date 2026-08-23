"use client";

import * as React from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { useRoom, type UnlockErrorKey } from "./room-provider";

export function UnlockScreen() {
  const room = useRoom();
  const { d } = useI18n();
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showRecovery, setShowRecovery] = React.useState(false);
  const [recoveryKey, setRecoveryKey] = React.useState("");

  const errorText = (key: UnlockErrorKey | null): string | undefined => {
    switch (key) {
      case "invalid-password":
        return d.unlockScreen.errInvalidPassword;
      case "invalid-recovery":
        return d.unlockScreen.errInvalidRecovery;
      case "too-many":
        return d.unlockScreen.errTooMany;
      case "cant-unlock":
        return d.unlockScreen.errCantUnlock;
      case "generic":
        return d.unlockScreen.errGeneric;
      default:
        return undefined;
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || room.unlockBusy) return;
    void room.unlock(password, recoveryKey.trim() || undefined);
  };

  return (
    <main className="flex h-dvh-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted">
            <Lock className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold">{d.unlockScreen.title}</h1>
          <p className="text-sm text-muted-foreground">
            {d.unlockScreen.subtitle}
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label={d.unlockScreen.password}
            htmlFor="room-password"
            error={errorText(room.unlockError)}
          >
            <div className="relative">
              <Input
                id="room-password"
                type={showPassword ? "text" : "password"}
                autoComplete="off"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
              />
              <button
                type="button"
                aria-label={
                  showPassword
                    ? d.unlockScreen.hidePassword
                    : d.unlockScreen.showPassword
                }
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </Field>
          {showRecovery ? (
            <Field
              label={d.unlockScreen.recoveryLabel}
              htmlFor="recovery-key"
              hint={d.unlockScreen.recoveryHint}
            >
              <Input
                id="recovery-key"
                type="text"
                autoComplete="off"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
              />
            </Field>
          ) : null}
          <Button
            type="submit"
            size="lg"
            disabled={!password || room.unlockBusy}
          >
            {room.unlockBusy ? (
              <>
                <Spinner className="text-accent-foreground" />{" "}
                {d.unlockScreen.unlocking}
              </>
            ) : (
              d.unlockScreen.unlock
            )}
          </Button>
          <button
            type="button"
            onClick={() => setShowRecovery((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showRecovery
              ? d.unlockScreen.hideRecovery
              : d.unlockScreen.showRecovery}
          </button>
        </form>
      </div>
    </main>
  );
}
