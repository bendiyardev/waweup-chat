import type { Metadata } from "next";
import { SecurityContent } from "@/components/pages/info-pages";

export const metadata: Metadata = {
  title: "Security",
};

export default function SecurityPage() {
  return <SecurityContent />;
}
