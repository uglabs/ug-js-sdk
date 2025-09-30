import { Message } from '../types'
import { NetworkEventHandlers } from './types'

export class WebSocketConnection {
  private websocket: WebSocket | null = null
  private handlers: NetworkEventHandlers
  private serverUrl: string

  constructor(serverUrl: string, handlers: NetworkEventHandlers) {
    this.serverUrl = serverUrl
    this.handlers = handlers
  }

  connect(): void {
    this.websocket = new WebSocket(this.serverUrl)
    this.setupHandlers()
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.onmessage = null
      this.websocket.onerror = null
      this.websocket.onclose = null
      this.websocket.close(1000, 'Client initiated disconnect')
      this.websocket = null
    }
  }

  send(data: any): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('Cant send. WebSocket is not open')
    }
    this.websocket.send(JSON.stringify(data))
  }

  isReady(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN
  }

  private setupHandlers(): void {
    if (!this.websocket) return
    this.websocket.onopen = () => {
      this.handlers.onOpen && this.handlers.onOpen()
    }
    this.websocket.onmessage = (event: MessageEvent) => {
      const message: Message = JSON.parse(event.data)
      this.handlers.onMessage && this.handlers.onMessage(message)
    }
    this.websocket.onerror = (error) => {
      this.handlers.onError && this.handlers.onError(error)
    }
    this.websocket.onclose = () => {
      this.handlers.onClose && this.handlers.onClose()
    }
  }
}
