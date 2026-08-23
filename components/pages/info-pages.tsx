"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/locale-provider";
import { PreferenceControls } from "@/components/settings/preference-controls";

export function PrivacyContent() {
  const { d } = useI18n();
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← waweup
        </Link>
        <PreferenceControls />
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-foreground">
        {d.privacyPage.title}
      </h1>
      <div className="mt-6 flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
        {d.privacyPage.paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </main>
  );
}

export function SecurityContent() {
  const { d } = useI18n();
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← waweup
        </Link>
        <PreferenceControls />
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-foreground">
        {d.securityPage.title}
      </h1>
      <div className="mt-8 flex flex-col gap-8">
        {d.securityPage.sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-base font-semibold text-foreground">
              {section.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {section.body}
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
