import { Message } from '../types'

export const ConversationNetworkEvents = {
  Message: 'message',
  Error: 'error',
  Disconnected: 'disconnected',
  Connected: 'connected',
} as const

export type ConversationNetworkEventType =
  (typeof ConversationNetworkEvents)[keyof typeof ConversationNetworkEvents]

export type ConversationNetworkEventHandlers = {
  message: (message: Message) => void
  error: (error: any) => void
  disconnected: () => void
  connected: () => void
}

export interface INetwork {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(data: any): Promise<void>
  isReady(): boolean
  updateContextValues(newValues: Record<string, string | number | boolean>): void
  on(event: ConversationNetworkEventType, callback: Function): void
  off(event: ConversationNetworkEventType, callback: Function): void
}

export type NetworkEventHandlers = {
  onOpen?: () => void
  onMessage?: (message: Message) => void
  onError?: (error: Event) => void
  onClose?: () => void
}

export interface MetadataMessage extends Message {
  type: 'metadata'
  headers?: Record<string, string>
}
