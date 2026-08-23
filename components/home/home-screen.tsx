"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/locale-provider";
import { PreferenceControls } from "@/components/settings/preference-controls";
import { CreateChatForm } from "./create-chat-form";

export function HomeScreen() {
  const { d } = useI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-10 text-center text-sm font-medium tracking-wide text-muted-foreground">
          waweup
        </p>
        <h1 className="mb-8 text-center text-xl font-semibold text-foreground">
          {d.home.title}
        </h1>
        <CreateChatForm />
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {d.home.tagline}
        </p>
      </div>
      <footer className="mt-16 flex flex-col items-center gap-4">
        <div className="flex gap-6 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">
            {d.common.privacy}
          </Link>
          <Link href="/security" className="hover:text-foreground">
            {d.common.security}
          </Link>
        </div>
        <PreferenceControls />
      </footer>
    </main>
  );
}
