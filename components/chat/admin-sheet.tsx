"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, LogOut, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { APP_CONFIG } from "@/lib/config";
import { expiresInParts } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { PreferenceControls } from "@/components/settings/preference-controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Avatar, Badge, Separator, Spinner } from "@/components/ui/misc";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRoom } from "./room-provider";

type PendingDialog =
  | { kind: "none" }
  | { kind: "clear" }
  | { kind: "destroy-1" }
  | { kind: "destroy-2" }
  | { kind: "change-password"; afterSecureRemove?: boolean };

export function AdminSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const room = useRoom();
  const router = useRouter();
  const { d, fmt } = useI18n();
  const [dialog, setDialog] = React.useState<PendingDialog>({ kind: "none" });
  const [busy, setBusy] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  const isOwner = room.me?.role === "owner";

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    setIsMobile(media.matches);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const guard = async (action: () => Promise<void>, errorText: string) => {
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(errorText);
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
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

  const leave = () =>
    guard(async () => {
      await room.leaveRoom();
      router.push("/");
    }, d.admin.leaveFailed);

  const expiresText = (): string => {
    if (!room.expiresAt) return "";
    const parts = expiresInParts(room.expiresAt);
    const time =
      parts.kind === "expired"
        ? d.time.expired
        : fmt(d.time[parts.kind], { n: parts.n });
    return fmt(d.admin.expiresIn, { time });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={isMobile ? "bottom" : "right"}>
          <div className="flex-1 overflow-y-auto p-5">
            <SheetTitle>{room.roomName ?? d.chat.encryptedRoom}</SheetTitle>
            <SheetDescription>{expiresText()}</SheetDescription>

            <section className="mt-6">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {d.admin.members}
              </h3>
              <ul className="mt-2 flex flex-col">
                {room.members.map((member) => (
                  <li
                    key={member.memberId}
                    className="flex items-center gap-3 py-2"
                  >
                    <span className="relative">
                      <Avatar name={member.name} />
                      <span
                        aria-hidden
                        className={
                          member.online
                            ? "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-emerald-500"
                            : "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-border-strong"
                        }
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {member.name ?? d.chat.unnamed}
                        {member.memberId === room.me?.memberId
                          ? ` ${d.admin.you}`
                          : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.online ? d.admin.online : d.admin.offline}
                      </p>
                    </div>
                    {member.role === "owner" ? (
                      <Badge>{d.admin.owner}</Badge>
                    ) : null}
                    {isOwner && member.role !== "owner" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={fmt(d.admin.manage, {
                              name: member.name ?? d.chat.unnamed,
                            })}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              void guard(
                                () => room.removeMember(member.memberId),
                                d.admin.removeFailed,
                              )
                            }
                          >
                            {d.admin.remove}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            onSelect={() =>
                              void guard(
                                () => room.banMember(member.memberId, false),
                                d.admin.banFailed,
                              )
                            }
                          >
                            {d.admin.ban}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            onSelect={() =>
                              void guard(
                                () => room.banMember(member.memberId, true),
                                d.admin.banFailed,
                              )
                            }
                          >
                            {d.admin.banIp}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onSelect={() =>
                              void guard(async () => {
                                await room.removeMember(member.memberId);
                                setDialog({
                                  kind: "change-password",
                                  afterSecureRemove: true,
                                });
                              }, d.admin.removeFailed)
                            }
                          >
                            {d.admin.secureRemove}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </li>
                ))}
              </ul>
              {room.members.length < APP_CONFIG.maxMembers ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 w-full"
                  onClick={() => void copyInvite()}
                >
                  <Link2 aria-hidden /> {d.admin.copyInviteLink}
                </Button>
              ) : null}
            </section>

            {isOwner ? (
              <>
                <Separator className="my-5" />
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {d.admin.access}
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void guard(
                          () => room.lockRoom(!room.locked),
                          d.admin.lockFailed,
                        )
                      }
                    >
                      {room.locked ? d.admin.unlockRoom : d.admin.lockRoom}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDialog({ kind: "change-password" })}
                    >
                      {d.admin.changePassword}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void guard(
                          () => room.rotateKey(),
                          d.admin.rotateFailed,
                        )
                      }
                    >
                      {d.admin.rotateKey}
                    </Button>
                  </div>
                </section>
                <Separator className="my-5" />
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {d.admin.data}
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDialog({ kind: "clear" })}
                    >
                      {d.admin.clearMessages}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDialog({ kind: "destroy-1" })}
                    >
                      {d.admin.destroyChat}
                    </Button>
                  </div>
                </section>
              </>
            ) : (
              <>
                <Separator className="my-5" />
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void leave()}
                >
                  <LogOut aria-hidden /> {d.admin.leaveChat}
                </Button>
              </>
            )}

            <Separator className="my-5" />
            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {d.admin.preferences}
              </h3>
              <PreferenceControls className="mt-2" />
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={dialog.kind === "clear"}
        onOpenChange={(o) => !o && setDialog({ kind: "none" })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{d.admin.clearTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {d.admin.clearBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{d.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void guard(async () => {
                  await room.clearAllMessages();
                  setDialog({ kind: "none" });
                  toast.success(d.admin.cleared);
                }, d.admin.clearFailed)
              }
            >
              {d.admin.clearConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog.kind === "destroy-1"}
        onOpenChange={(o) => !o && setDialog({ kind: "none" })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{d.admin.destroy1Title}</AlertDialogTitle>
            <AlertDialogDescription>
              {d.admin.destroy1Body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{d.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => setDialog({ kind: "destroy-2" })}
            >
              {d.admin.destroy1Confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog.kind === "destroy-2"}
        onOpenChange={(o) => !o && setDialog({ kind: "none" })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{d.admin.destroy2Title}</AlertDialogTitle>
            <AlertDialogDescription>
              {d.admin.destroy2Body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{d.admin.destroy2Cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void guard(async () => {
                  await room.destroyRoom();
                  setDialog({ kind: "none" });
                }, d.admin.destroyFailed)
              }
            >
              {d.admin.destroy2Confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChangePasswordDialog
        open={dialog.kind === "change-password"}
        afterSecureRemove={
          dialog.kind === "change-password" && !!dialog.afterSecureRemove
        }
        onOpenChange={(o) => !o && setDialog({ kind: "none" })}
      />
    </>
  );
}

function ChangePasswordDialog({
  open,
  afterSecureRemove,
  onOpenChange,
}: {
  open: boolean;
  afterSecureRemove: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const room = useRoom();
  const { d, fmt } = useI18n();
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < APP_CONFIG.minPasswordLength) {
      setError(fmt(d.admin.cpErrShort, { min: APP_CONFIG.minPasswordLength }));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await room.changePassword(password);
      toast.success(d.admin.cpSuccess, {
        description: d.admin.cpSuccessDesc,
      });
      setPassword("");
      onOpenChange(false);
    } catch {
      setError(d.admin.cpErrFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.admin.cpTitle}</DialogTitle>
          <DialogDescription>
            {afterSecureRemove ? d.admin.cpDescSecure : d.admin.cpDescNormal}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label={d.admin.cpNewPassword}
            htmlFor="new-room-password"
            error={error ?? undefined}
            hint={fmt(d.admin.cpHint, { min: APP_CONFIG.minPasswordLength })}
          >
            <Input
              id="new-room-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {d.common.cancel}
            </Button>
            <Button type="submit" disabled={busy || !password}>
              {busy ? (
                <>
                  <Spinner className="text-accent-foreground" />{" "}
                  {d.admin.cpUpdating}
                </>
              ) : (
                d.admin.cpSubmit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
