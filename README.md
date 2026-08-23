# WaweChat

Temporary, private, end-to-end encrypted chat rooms. No accounts, no e-mail,
no phone numbers, no database — create a room, share the link and the
password separately, talk, let it expire, gone.

```text
chat.waweup.com
   ↓
Create private chat  →  Chat name · Password · Expiration
   ↓
Unique room URL  →  Chat (max 3 people)  →  Auto delete
```

## What is Waweup?

WaweChat is the Waweup take on disposable messaging: a single Next.js app
where the **server never sees plaintext**. Messages, files, voice messages,
the chat name and even usernames are encrypted in the browser before they
leave the device. The backend stores only ciphertext blobs and relays only
ciphertext events.

## Architecture

Single Next.js (App Router) project deployed on Vercel:

| Concern            | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Web + API          | Next.js App Router, React 19, TypeScript strict, Tailwind CSS |
| UI                 | ReUI/shadcn-style copy-own components (`components/ui`)       |
| Persistence        | **Vercel Blob, `access: private`** — no SQL/NoSQL database    |
| Realtime           | **Pusher Channels** (presence + events; ciphertext only)      |
| Crypto             | Web Crypto API (AES-256-GCM, HKDF), Argon2id via `hash-wasm`  |
| Heavy work         | Web Worker (`workers/crypto.worker.ts`)                       |
| Sessions           | Signed stateless JWT in `HttpOnly; Secure; SameSite=Strict` cookies |
| Cleanup            | Daily Vercel Cron over an `expiry/YYYY-MM-DD/` index          |
| Languages          | English · Türkçe · Русский (auto-detected, switchable, cookie-persisted) |
| Theme              | Light / Dark / System — flash-free via a CSP-nonce'd inline script |

### Blob object layout

```text
rooms/{roomId}/meta.json              — mutable, updated via ETag + ifMatch (CAS, max 3 retries)
rooms/{roomId}/messages/{key}.json    — immutable encrypted envelopes (create-only writes)
rooms/{roomId}/files/{attachmentId}/00001.bin … — immutable encrypted chunks
expiry/YYYY-MM-DD/{roomId}.json       — cleanup index
```

Messages are stored under the lexicographic **inverse** of their ULID so an
ascending Blob listing returns newest-first — that gives real cursor
pagination ("latest 50, scroll up for older") on a store that only lists
ascending.

## Encryption model

```text
password ──Argon2id (64 MiB, t=3, Web Worker)──► masterKey
masterKey ──HKDF "waweup/v1/authentication"──► authKey ──SHA-256──► verifier (server stores only this)
masterKey ──HKDF "waweup/v1/encryption"────► KEK (never leaves the browser)
random 32-byte epoch keys ──AES-GCM wrapped with KEK──► stored server-side (wrapped)
content ──AES-256-GCM(epochKey, fresh 96-bit IV, AAD = version|roomId|messageId|kind|epoch)──► ciphertext
files    ──HKDF(epochKey, attachmentId) per-file key, 3 MiB chunks, fresh IV per chunk
```

- The room ID (192 random bits, base64url) is generated client-side because
  the AAD binds it; the server enforces the format and rejects collisions
  with a create-only write.
- **Key epochs**: changing the password re-wraps every historical epoch key
  under the new KEK and starts a new epoch in one atomic CAS update. Holders
  of the old password keep the history they already had but cannot read
  anything sent afterwards. "Secure remove + rotate key" = remove member +
  set a new password.
- The server stores: KDF salt/params, the verifier hash, wrapped epoch keys,
  encrypted names, ciphertext envelopes, member IDs/token hashes, hashed ban
  fingerprints. It never stores or sees: the password, any encryption key,
  plaintext names, messages, files or voice audio.

## Languages & theme

The whole UI (including the Privacy and Security pages) ships in **English,
Turkish and Russian**. The first visit auto-detects the browser language;
after that the choice is stored in a preference cookie (`wawe-locale`) so
server-side rendering is already in the right language — no flash. Switchers
live on the home footer, on the info pages and in the room admin sheet.

**Light, dark and system** themes are supported. The stored preference
(`wawe-theme` in localStorage) is applied by a nonce'd inline script before
first paint, so there is never a flash of the wrong theme, and the dark
palette keeps full contrast (dedicated token set in `globals.css`).

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill in the values below
pnpm dev
```

Two ways to run locally:

1. **Full stack** — create a Blob store + Pusher app (see below) and put real
   values in `.env.local`. Everything works, including uploads and realtime.
2. **Storage-free smoke mode** — set `WAWE_TEST_MODE=1` (no other secrets
   needed). The server uses an in-memory blob store and skips Pusher; you can
   create rooms and chat in one browser session. File uploads and realtime
   need the real services. Never set this in production.

## Pusher setup

1. Create a **Channels** app at pusher.com (choose a cluster).
2. Copy app id / key / secret / cluster into the `PUSHER_*` variables, and
   the key + cluster into the two `NEXT_PUBLIC_PUSHER_*` variables.
3. In the app settings enable **client events** (used only for the typing
   indicator; everything still works without it).

Pusher carries ciphertext envelopes and technical IDs only, and is never the
source of truth — history always reconciles from Blob via
`GET /api/rooms/{id}/messages?after=…` on reconnect.

## Vercel Blob setup

1. In the Vercel dashboard create a **Blob store** and connect it to the
   project (this injects `BLOB_READ_WRITE_TOKEN`).
2. All objects are written with `access: "private"`; downloads are authorized
   per-request by the app, uploads happen browser → Blob via short-lived
   scoped client tokens (`/api/rooms/{id}/upload-token`). The read-write
   token never reaches the client.

## Environment variables

See `.env.example`. All of these are required in production and validated at
startup with a loud error if missing:

```env
NEXT_PUBLIC_APP_URL=       # public URL of the deployment
BLOB_READ_WRITE_TOKEN=     # from the connected Vercel Blob store
PUSHER_APP_ID= PUSHER_KEY= PUSHER_SECRET= PUSHER_CLUSTER=
NEXT_PUBLIC_PUSHER_KEY= NEXT_PUBLIC_PUSHER_CLUSTER=
SESSION_SIGNING_SECRET=    # 32+ random bytes (e.g. openssl rand -base64 48)
IP_HMAC_SECRET=            # 32+ random bytes — IPs are only ever stored as HMACs
CRON_SECRET=               # protects /api/cron/cleanup
```

## Running tests

```bash
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm test        # Vitest: crypto, sessions, CAS, validation + full API-route
                 # integration flows on an in-memory blob store
pnpm exec playwright install chromium   # one-time browser download
pnpm test:e2e    # Playwright (desktop + Pixel 7 projects)
```

E2E specs that depend on storage/realtime **skip themselves** unless
`BLOB_READ_WRITE_TOKEN`, `PUSHER_SECRET` and `NEXT_PUBLIC_PUSHER_KEY` are
present — there are no fake green runs.

## Deploying to Vercel

`vercel.json` schedules the cleanup cron **once per day** (`17 4 * * *`) —
Hobby-plan compatible. The cron is hygiene only: an expired room answers
`410 Gone` from the exact second `expiresAt` passes, whether or not cleanup
has run.

### Deploy checklist

```text
1. Create Vercel project (import this repo)
2. Create a private Vercel Blob store and connect it
3. Create a Pusher Channels app (enable client events for typing)
4. Add all environment variables from .env.example
5. Generate a strong SESSION_SIGNING_SECRET
6. Generate a strong IP_HMAC_SECRET
7. Generate a CRON_SECRET
8. Deploy
9. Confirm the cron job appears under Settings → Cron Jobs
10. Test with two browsers + one mobile device
```

## Security limitations (honest edition)

- **Anyone with the password can read the room.** The password is the room's
  only long-term secret; share the link and password through different
  channels. You cannot cryptographically exclude someone who knows the
  password without changing it — which is exactly what "secure remove +
  rotate key" does.
- **Deletion is not memory erasure.** Deleting a message removes it from
  storage and connected WaweChat clients. It cannot recall screenshots,
  copies, or what other people already read.
- **IP bans are best effort.** Only a keyed HMAC of the join IP is stored;
  a VPN or a new network produces a new fingerprint. No "device ban" is
  claimed anywhere.
- **Rate limiting is per-instance.** Serverless instances don't share
  memory, so in-app limits are best-effort (documented, not oversold);
  Argon2id + strong passwords are the real brute-force defense. Pair with
  Vercel's platform firewall/rate limits for the public endpoints.
- **Metadata exists.** The server necessarily sees ciphertext sizes, message
  kinds, timing and connection metadata.
- **Membership cookie vs. keys.** The signed member cookie survives a page
  refresh, but encryption keys live only in tab memory — the password is
  deliberately asked again after a refresh.
- **Realtime edge**: a message deleted while a client is offline disappears
  for that client on its next full history load (reconciliation fetches only
  newer messages).
- The app depends on the security of Vercel, Pusher and the browser's Web
  Crypto implementation. A compromised device or browser extension is out of
  scope for any web app.
