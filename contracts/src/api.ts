/**
 * REST API Contracts for NanoClaw Service Mesh
 *
 * All inter-service communication uses these types.
 * Services import from @nanoclaw/contracts to ensure type safety.
 */

// ─── Inbound Message (WhatsApp Gateway → API Gateway → Core) ───

export interface InboundMessageRequest {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  isBotMessage: boolean;
  channel: string; // 'whatsapp'
}

export interface InboundMessageResponse {
  ok: boolean;
}

// ─── Outbound Message (Core → API Gateway → WhatsApp Gateway) ───

export interface OutboundMessageRequest {
  chatJid: string;
  text: string;
}

export interface OutboundMessageResponse {
  ok: boolean;
  error?: string;
}

// ─── Chat Metadata (WhatsApp Gateway → API Gateway → Core) ───

export interface ChatMetadataRequest {
  chatJid: string;
  timestamp: string;
  name?: string;
  channel: string; // 'whatsapp'
  isGroup?: boolean;
}

export interface ChatMetadataResponse {
  ok: boolean;
}

// ─── Typing Indicator (Core → API Gateway → WhatsApp Gateway) ───

export interface TypingRequest {
  chatJid: string;
  isTyping: boolean;
}

export interface TypingResponse {
  ok: boolean;
}

// ─── Registered Groups (WhatsApp Gateway ← API Gateway ← Core) ───

export interface RegisteredGroupInfo {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  isMain?: boolean;
  requiresTrigger?: boolean;
}

export interface RegisteredGroupsResponse {
  groups: Record<string, RegisteredGroupInfo>;
}

// ─── Group Sync (Core → API Gateway → WhatsApp Gateway) ───

export interface GroupSyncRequest {
  force: boolean;
}

export interface GroupSyncResponse {
  ok: boolean;
  count?: number;
}

// ─── Group Join (Core → API Gateway → WhatsApp Gateway) ───

export interface GroupJoinRequest {
  invite: string;
}

export interface GroupJoinResponse {
  ok: boolean;
  jid?: string;
  error?: string;
}
