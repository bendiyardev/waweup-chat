import { timingSafeEqual } from "node:crypto";
import { getStore } from "@/lib/server/blob";
import { serverEnv } from "@/lib/server/env";
import { handleApiError, jsonError, jsonOk } from "@/lib/server/http";
import { logOp } from "@/lib/server/log";
import { expiryPrefix } from "@/lib/server/paths";
import { deleteRoomData } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv().CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily physical cleanup of expired rooms, driven by the `expiry/YYYY-MM-DD/`
 * index — never a blind scan of the whole store. Security never depends on
 * this job: expired rooms answer 410 the moment `expiresAt` passes. The job
 * is idempotent; an interrupted run simply resumes on the next execution.
 */
export async function GET(req: Request) {
  const start = Date.now();
  try {
    if (!authorized(req)) return jsonError(401, "unauthorized");

    const store = getStore();
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    let deletedRooms = 0;
    let scanned = 0;
    let cursor: string | undefined;

    // Bounded batches keep each run well inside the function time limit;
    // anything left over is picked up by the next daily run.
    for (let page = 0; page < 40; page++) {
      const result = await store.list(expiryPrefix(), { cursor, limit: 100 });
      let sawFutureDate = false;
      for (const blob of result.blobs) {
        scanned++;
        // pathname: expiry/YYYY-MM-DD/{roomId}.json
        const parts = blob.pathname.split("/");
        const dateFolder = parts[1] ?? "";
        const fileName = parts[2] ?? "";
        if (!fileName.endsWith(".json")) continue;
        if (dateFolder > today) {
          // Listing is ascending by pathname, so nothing later is due either.
          sawFutureDate = true;
          break;
        }
        const roomId = fileName.slice(0, -".json".length);
        const entry = await store.readJson<{ expiresAt: string }>(
          blob.pathname,
        );
        const expiresAtMs = entry
          ? new Date(entry.data.expiresAt).getTime()
          : 0;
        if (expiresAtMs <= now) {
          await deleteRoomData(roomId);
          // Remove the index entry itself even if the meta was already gone.
          await store.del([blob.pathname]);
          deletedRooms++;
        }
      }
      if (sawFutureDate || !result.hasMore || !result.cursor) break;
      cursor = result.cursor;
    }

    logOp({
      op: "cron.cleanup",
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ ok: true, scanned, deletedRooms });
  } catch (error) {
    return handleApiError(error, "cron.cleanup");
  }
}
