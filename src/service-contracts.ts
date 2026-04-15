/**
 * REST API Contracts for NanoClaw Service Mesh
 *
 * All inter-service communication uses these types.
 * This file is duplicated in each service that needs it.
 * The canonical source is contracts/src/api.ts.
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
  channel: string;
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
  channel: string;
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

// ─── Registered Groups ───

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

// ─── Group Sync ───

export interface GroupSyncRequest {
  force: boolean;
}

export interface GroupSyncResponse {
  ok: boolean;
  count?: number;
}

// ─── Group Join ───

export interface GroupJoinRequest {
  invite: string;
}

export interface GroupJoinResponse {
  ok: boolean;
  jid?: string;
  error?: string;
}

// ─── Health ───

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface DependencyHealth {
  name: string;
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  service: string;
  version: string;
  status: ServiceStatus;
  uptime: number;
  dependencies: DependencyHealth[];
}

export interface ReadyResponse {
  ready: boolean;
}
