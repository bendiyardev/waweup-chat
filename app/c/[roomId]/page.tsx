import type { Metadata } from "next";
import { RoomProvider } from "@/components/chat/room-provider";
import { RoomShell } from "@/components/chat/room-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private chat",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
  },
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <RoomProvider roomId={roomId}>
      <RoomShell />
    </RoomProvider>
  );
}
