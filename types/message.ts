export const MESSAGE_KINDS = [
  "text",
  "file",
  "image",
  "video",
  "audio",
  "voice",
  "system",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const ATTACHMENT_KINDS: readonly MessageKind[] = [
  "file",
  "image",
  "video",
  "audio",
  "voice",
];

/**
 * The envelope stored in Blob and relayed over Pusher. Contains only technical
 * metadata; all content lives inside `ct`.
 */
export interface MessageEnvelope {
  protocolVersion: 1;
  roomId: string;
  messageId: string;
  memberId: string;
  kind: MessageKind;
  keyEpoch: number;
  createdAt: string;
  /**
   * Present only for attachment messages so the server can delete the
   * ciphertext chunks when the message is deleted. Random ID, no content.
   */
  attachmentId?: string;
  iv: string;
  ct: string;
}

/** Metadata of an encrypted attachment. Lives inside the encrypted payload. */
export interface AttachmentMeta {
  attachmentId: string;
  name: string;
  mime: string;
  size: number;
  chunkCount: number;
  chunkSize: number;
  /** Voice message duration in seconds, when applicable. */
  durationSeconds?: number;
}

export type SystemEventType =
  | "joined"
  | "left"
  | "removed"
  | "banned"
  | "password-changed"
  | "key-rotated"
  | "chat-cleared"
  | "room-locked"
  | "room-unlocked";

/** The decrypted content of a message. Never leaves the browser in plaintext. */
export interface MessagePayload {
  displayName: string;
  text?: string;
  replyTo?: {
    messageId: string;
    displayName: string;
    preview: string;
  };
  attachment?: AttachmentMeta;
  system?: {
    type: SystemEventType;
    /** Display name of the affected member, when applicable. */
    subject?: string;
  };
}

export interface ListMessagesResult {
  messages: MessageEnvelope[];
  /** Opaque cursor for loading older messages; null when exhausted. */
  cursor: string | null;
  hasMore: boolean;
}
