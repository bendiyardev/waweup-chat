"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      toastOptions={{
        style: {
          background: "var(--color-surface)",
          color: "var(--color-foreground)",
          border: "1px solid var(--color-border)",
          borderRadius: "12px",
        },
      }}
    />
  );
}
