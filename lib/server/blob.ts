import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del as blobDel,
  get as blobGet,
  list as blobList,
  put as blobPut,
} from "@vercel/blob";
import { serverEnv, isTestEnv } from "./env";

/** Thrown when a conditional write loses a race (ETag mismatch / exists). */
export class StoreConflictError extends Error {
  constructor() {
    super("Storage precondition failed");
    this.name = "StoreConflictError";
  }
}

export interface WriteOptions {
  /** ETag the existing object must have (compare-and-swap update). */
  ifMatch?: string;
  /** Fail if the object already exists (immutable create). */
  createOnly?: boolean;
  contentType?: string;
}

export interface ListedBlob {
  pathname: string;
  size: number;
}

export interface ListResult {
  blobs: ListedBlob[];
  cursor: string | null;
  hasMore: boolean;
}

export interface BlobStore {
  readJson<T>(pathname: string): Promise<{ data: T; etag: string } | null>;
  writeJson(
    pathname: string,
    data: unknown,
    options?: WriteOptions,
  ): Promise<{ etag: string }>;
  readBytes(pathname: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
  } | null>;
  del(pathnames: string[]): Promise<void>;
  list(
    prefix: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<ListResult>;
}

class VercelBlobStore implements BlobStore {
  private token(): string {
    return serverEnv().BLOB_READ_WRITE_TOKEN;
  }

  async readJson<T>(pathname: string) {
    const result = await this.getRaw(pathname);
    if (!result) return null;
    return {
      data: JSON.parse(new TextDecoder().decode(result.bytes)) as T,
      etag: result.etag,
    };
  }

  async writeJson(pathname: string, data: unknown, options?: WriteOptions) {
    return this.putRaw(pathname, JSON.stringify(data), {
      ...options,
      contentType: options?.contentType ?? "application/json",
    });
  }

  async readBytes(pathname: string) {
    const result = await this.getRaw(pathname);
    if (!result) return null;
    return { bytes: result.bytes, contentType: result.contentType };
  }

  async del(pathnames: string[]) {
    if (pathnames.length === 0) return;
    await blobDel(pathnames, { token: this.token() });
  }

  async list(prefix: string, options?: { cursor?: string; limit?: number }) {
    const result = await blobList({
      prefix,
      cursor: options?.cursor,
      limit: options?.limit,
      token: this.token(),
    });
    return {
      blobs: result.blobs.map((b) => ({ pathname: b.pathname, size: b.size })),
      cursor: result.cursor ?? null,
      hasMore: result.hasMore,
    };
  }

  private async getRaw(pathname: string) {
    try {
      const result = await blobGet(pathname, {
        access: "private",
        // Metadata reads must never be served stale from a CDN cache:
        // compare-and-swap correctness depends on it.
        useCache: false,
        token: this.token(),
      });
      if (!result || result.statusCode !== 200) return null;
      const buffer = await new Response(result.stream).arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        etag: result.blob.etag,
        contentType: result.blob.contentType,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }

  private async putRaw(
    pathname: string,
    body: string | Uint8Array,
    options?: WriteOptions,
  ) {
    try {
      const result = await blobPut(pathname, body as string, {
        access: "private",
        token: this.token(),
        addRandomSuffix: false,
        contentType: options?.contentType,
        ...(options?.createOnly
          ? { allowOverwrite: false }
          : options?.ifMatch
            ? { allowOverwrite: true, ifMatch: options.ifMatch }
            : { allowOverwrite: true }),
      });
      return { etag: (result as { etag?: string }).etag ?? "" };
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        throw new StoreConflictError();
      }
      if (
        options?.createOnly &&
        error instanceof Error &&
        /exist|precondition|conflict/i.test(error.message)
      ) {
        throw new StoreConflictError();
      }
      throw error;
    }
  }
}

/**
 * In-memory store used only by the test suite. Implements the same ETag
 * compare-and-swap semantics as Vercel Blob so concurrency logic is testable.
 */
class MemoryBlobStore implements BlobStore {
  private objects = new Map<
    string,
    { body: Uint8Array; etag: string; contentType: string }
  >();
  private counter = 0;

  async readJson<T>(pathname: string) {
    const entry = this.objects.get(pathname);
    if (!entry) return null;
    return {
      data: JSON.parse(new TextDecoder().decode(entry.body)) as T,
      etag: entry.etag,
    };
  }

  async writeJson(pathname: string, data: unknown, options?: WriteOptions) {
    return this.write(
      pathname,
      new TextEncoder().encode(JSON.stringify(data)),
      options,
      options?.contentType ?? "application/json",
    );
  }

  async readBytes(pathname: string) {
    const entry = this.objects.get(pathname);
    if (!entry) return null;
    return { bytes: entry.body, contentType: entry.contentType };
  }

  async del(pathnames: string[]) {
    for (const p of pathnames) this.objects.delete(p);
  }

  async list(prefix: string, options?: { cursor?: string; limit?: number }) {
    const limit = options?.limit ?? 1000;
    const all = [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const startIndex = options?.cursor ? Number(options.cursor) : 0;
    const page = all.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + page.length;
    return {
      blobs: page.map((pathname) => ({
        pathname,
        size: this.objects.get(pathname)?.body.length ?? 0,
      })),
      cursor: nextIndex < all.length ? String(nextIndex) : null,
      hasMore: nextIndex < all.length,
    };
  }

  /** Test helper for writing binary chunks. */
  async writeBytesDirect(
    pathname: string,
    body: Uint8Array,
    contentType = "application/octet-stream",
  ) {
    return this.write(pathname, body, undefined, contentType);
  }

  private async write(
    pathname: string,
    body: Uint8Array,
    options: WriteOptions | undefined,
    contentType: string,
  ) {
    const existing = this.objects.get(pathname);
    if (options?.createOnly && existing) throw new StoreConflictError();
    if (options?.ifMatch && existing && existing.etag !== options.ifMatch) {
      throw new StoreConflictError();
    }
    if (options?.ifMatch && !existing) throw new StoreConflictError();
    const etag = `"m${++this.counter}"`;
    this.objects.set(pathname, { body, etag, contentType });
    return { etag };
  }

  reset(): void {
    this.objects.clear();
  }
}

let store: BlobStore | null = null;

// In test/smoke mode the memory store must be shared across every route
// bundle in the same process (Next bundles each route separately, so plain
// module state would give each route its own store). globalThis is the one
// registry they all share. Production always uses Vercel Blob.
const MEMORY_STORE_KEY = "__waweMemoryBlobStore";

function sharedMemoryStore(): MemoryBlobStore {
  const holder = globalThis as unknown as Record<string, unknown>;
  // No instanceof here: each route bundle has its own class identity, but
  // they must all share the one instance stored on globalThis.
  if (!holder[MEMORY_STORE_KEY]) {
    holder[MEMORY_STORE_KEY] = new MemoryBlobStore();
  }
  return holder[MEMORY_STORE_KEY] as MemoryBlobStore;
}

export function getStore(): BlobStore {
  if (store) return store;
  store = isTestEnv() ? sharedMemoryStore() : new VercelBlobStore();
  return store;
}

/** Test-only: reset the in-memory store between tests. */
export function resetMemoryStore(): void {
  if (isTestEnv()) sharedMemoryStore().reset();
}

export function getMemoryStore(): MemoryBlobStore | null {
  return isTestEnv() ? sharedMemoryStore() : null;
}
