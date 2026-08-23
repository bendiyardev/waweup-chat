import type { Metadata } from "next";
import { PrivacyContent } from "@/components/pages/info-pages";

export const metadata: Metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
