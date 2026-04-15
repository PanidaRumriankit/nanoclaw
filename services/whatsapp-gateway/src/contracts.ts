/**
 * Shared contract types for NanoClaw services.
 * Canonical source: contracts/src/api.ts + contracts/src/health.ts
 */

// ─── API Types ───

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

export interface OutboundMessageRequest {
  chatJid: string;
  text: string;
}

export interface ChatMetadataRequest {
  chatJid: string;
  timestamp: string;
  name?: string;
  channel: string;
  isGroup?: boolean;
}

export interface TypingRequest {
  chatJid: string;
  isTyping: boolean;
}

export interface GroupSyncRequest {
  force: boolean;
}

export interface GroupJoinRequest {
  invite: string;
}

// ─── Health Types ───

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
