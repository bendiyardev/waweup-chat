"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { APP_CONFIG, type ExpirationPreset } from "@/lib/config";
import { api, ApiClientError } from "@/lib/client/api";
import { prepareCreate } from "@/lib/client/crypto-actions";
import { setRoomKeys } from "@/lib/client/keystore";
import { generateRoomId } from "@/lib/crypto/ids";
import { wrapEpochKey } from "@/lib/crypto/keys";
import { encryptRoomName } from "@/lib/crypto/protocol";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/misc";
import { EXPIRATION_PRESETS } from "@/lib/config";

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(APP_CONFIG.roomNameMinLength, "errNameRequired")
    .max(APP_CONFIG.roomNameMaxLength, "errNameLong"),
  password: z
    .string()
    .min(APP_CONFIG.minPasswordLength, "errPasswordShort")
    .max(APP_CONFIG.maxPasswordLength, "errPasswordLong"),
  expiresPreset: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

function passwordStrength(password: string): "weak" | "good" | "strong" {
  if (password.length < 12) return "weak";
  const variety =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  if (password.length >= 16 && variety >= 3) return "strong";
  return "good";
}

export function CreateChatForm() {
  const router = useRouter();
  const { d, fmt } = useI18n();
  const [showPassword, setShowPassword] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<{
    roomId: string;
    recoveryKey: string;
  } | null>(null);
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", password: "", expiresPreset: "7d" },
  });
  const passwordValue = form.watch("password");

  // Validation messages are stored as dictionary keys and translated here.
  const translateError = (key?: string): string | undefined => {
    switch (key) {
      case "errNameRequired":
        return d.home.errNameRequired;
      case "errNameLong":
        return fmt(d.home.errNameLong, { max: APP_CONFIG.roomNameMaxLength });
      case "errPasswordShort":
        return fmt(d.home.errPasswordShort, {
          min: APP_CONFIG.minPasswordLength,
        });
      case "errPasswordLong":
        return d.home.errPasswordLong;
      default:
        return key;
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (creating) return;
    setCreating(true);
    try {
      const prepared = await prepareCreate(values.name, values.password);
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const roomId = generateRoomId();
        const encryptedRoomName = await encryptRoomName(
          prepared.epochKey,
          values.name,
          roomId,
          1,
        );
        const wrappedEpochKey = await wrapEpochKey(
          prepared.kek,
          prepared.epochKeyRaw,
          roomId,
          1,
        );
        try {
          const res = await api.createRoom(
            {
              roomId,
              encryptedRoomName,
              salt: prepared.salt,
              kdf: prepared.kdf,
              authKey: prepared.authKeyB64,
              wrappedEpochKey,
              recoveryKeyHash: prepared.recoveryKeyHash,
              expiresPreset: values.expiresPreset as ExpirationPreset,
            },
            idempotencyKeyRef.current,
          );
          setRoomKeys(res.roomId, {
            kek: prepared.kek,
            authKeyB64: prepared.authKeyB64,
            cryptoVersion: 1,
            currentEpoch: 1,
            epochKeys: new Map([
              [1, { key: prepared.epochKey, raw: prepared.epochKeyRaw }],
            ]),
          });
          setCreated({ roomId: res.roomId, recoveryKey: prepared.recoveryKey });
          return;
        } catch (error) {
          // Practically impossible ID collision: retry with a fresh ID.
          if (error instanceof ApiClientError && error.code === "room_exists") {
            lastError = error;
            continue;
          }
          throw error;
        }
      }
      throw lastError ?? new Error("create failed");
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 429) {
        toast.error(d.home.tooManyRooms);
      } else {
        toast.error(d.home.createFailed);
      }
      idempotencyKeyRef.current = crypto.randomUUID();
    } finally {
      setCreating(false);
    }
  };

  const strength = passwordValue ? passwordStrength(passwordValue) : null;

  return (
    <>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-5"
        noValidate
      >
        <Field
          label={d.home.chatName}
          htmlFor="chat-name"
          error={translateError(form.formState.errors.name?.message)}
        >
          <Input
            id="chat-name"
            autoComplete="off"
            maxLength={APP_CONFIG.roomNameMaxLength}
            {...form.register("name")}
          />
        </Field>
        <Field
          label={d.home.password}
          htmlFor="chat-password"
          error={translateError(form.formState.errors.password?.message)}
          hint={
            strength
              ? strength === "weak"
                ? d.home.strengthWeak
                : strength === "good"
                  ? d.home.strengthGood
                  : d.home.strengthStrong
              : undefined
          }
        >
          <div className="relative">
            <Input
              id="chat-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className="pr-11"
              {...form.register("password")}
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
        <Field label={d.home.expiresAfter} htmlFor="chat-expiry">
          <NativeSelect id="chat-expiry" {...form.register("expiresPreset")}>
            {(
              Object.keys(EXPIRATION_PRESETS) as (keyof typeof d.expiry)[]
            ).map((value) => (
              <option key={value} value={value}>
                {d.expiry[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" size="lg" disabled={creating} className="mt-1">
          {creating ? (
            <>
              <Spinner className="text-accent-foreground" /> {d.home.creating}
            </>
          ) : (
            d.home.create
          )}
        </Button>
      </form>

      <Dialog
        open={created !== null}
        onOpenChange={(open) => {
          if (!open && created) router.push(`/c/${created.roomId}`);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{d.home.recoveryTitle}</DialogTitle>
            <DialogDescription>{d.home.recoveryDesc}</DialogDescription>
          </DialogHeader>
          <code className="block select-all break-all rounded-[10px] border border-border bg-surface-muted px-3 py-2.5 text-sm">
            {created?.recoveryKey}
          </code>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                if (!created) return;
                try {
                  await navigator.clipboard.writeText(created.recoveryKey);
                  toast.success(d.home.keyCopied);
                } catch {
                  toast.error(d.home.copyFailed);
                }
              }}
            >
              {d.home.copyKey}
            </Button>
            <Button
              onClick={() => created && router.push(`/c/${created.roomId}`)}
            >
              {d.home.continueToChat}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
