import { ROOM_ID_REGEX } from "@/lib/crypto/ids";
import { ApiError } from "./http";

export function validateRoomId(roomId: string): string {
  if (!ROOM_ID_REGEX.test(roomId)) {
    throw new ApiError(404, "room_not_found");
  }
  return roomId;
}
