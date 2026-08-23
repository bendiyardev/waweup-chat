"use client";

import * as React from "react";
import { APP_CONFIG } from "@/lib/config";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { useRoom } from "./room-provider";

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f\\u200e\\u200f\\u202a-\\u202e]");

export function NameScreen() {
  const room = useRoom();
  const { d, fmt } = useI18n();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (
      trimmed.length < APP_CONFIG.displayNameMinLength ||
      trimmed.length > APP_CONFIG.displayNameMaxLength
    ) {
      setError(
        fmt(d.nameScreen.errLength, {
          min: APP_CONFIG.displayNameMinLength,
          max: APP_CONFIG.displayNameMaxLength,
        }),
      );
      return;
    }
    if (CONTROL_CHARS.test(trimmed)) {
      setError(d.nameScreen.errChars);
      return;
    }
    setError(null);
    try {
      await room.join(trimmed);
    } catch {
      setError(d.nameScreen.errJoin);
    }
  };

  return (
    <main className="flex h-dvh-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <h1 className="text-lg font-semibold">{d.nameScreen.title}</h1>
          <p className="text-sm text-muted-foreground">
            {d.nameScreen.subtitle}
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label={d.nameScreen.username}
            htmlFor="display-name"
            error={error ?? undefined}
          >
            <Input
              id="display-name"
              autoFocus
              autoComplete="off"
              maxLength={APP_CONFIG.displayNameMaxLength}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" disabled={!name.trim() || room.joinBusy}>
            {room.joinBusy ? (
              <>
                <Spinner className="text-accent-foreground" />{" "}
                {d.nameScreen.joining}
              </>
            ) : (
              d.nameScreen.join
            )}
          </Button>
        </form>
      </div>
    </main>
  );
}
