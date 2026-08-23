import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "WaweChat — private encrypted chat",
    template: "%s · WaweChat",
  },
  description:
    "Create a temporary, end-to-end encrypted chat room. No accounts, auto delete.",
};

// Every page renders per-request so Next can stamp the middleware's CSP
// nonce onto its inline scripts; a statically prerendered page would ship
// nonce-less scripts that the strict CSP blocks.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

/** Applies the stored theme before first paint (runs under the CSP nonce). */
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("wawe-theme");var d=s==="dark"||((s===null||s==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const cookieLocale = (await cookies()).get("wawe-locale")?.value;
  const hadCookie = (LOCALES as readonly string[]).includes(
    cookieLocale ?? "",
  );
  const initialLocale: Locale = hadCookie ? (cookieLocale as Locale) : "en";

  return (
    <html
      lang={initialLocale}
      className={GeistSans.variable}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          <LocaleProvider initialLocale={initialLocale} hadCookie={hadCookie}>
            {children}
            <Toaster />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
