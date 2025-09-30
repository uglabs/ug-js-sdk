import { ILogger } from '../types'

export class EventEmitter<T extends Record<string, any> = Record<string, any>> {
  private eventListeners: Map<keyof T, Array<(data: any) => void | Promise<void>>> = new Map()
  protected logger: ILogger

  constructor(logger: ILogger) {
    this.logger = logger
  }

  on<K extends keyof T>(event: K, callback: T[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(callback as (data: any) => void | Promise<void>)
  }

  off<K extends keyof T>(event: K, callback: T[K]): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      const index = listeners.indexOf(callback as (data: any) => void | Promise<void>)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  async emit<K extends keyof T>(event: K, data?: Parameters<T[K]>[0]): Promise<void> {
    const listeners = this.eventListeners.get(event) || []

    if (this.logger) {
      this.logger.debug(`Emitting event: ${String(event)}`, data ? { data } : undefined)
    }

    // Use Promise.all to wait for all async handlers to complete
    await Promise.all(listeners.map((callback) => Promise.resolve(callback(data))))
  }

  removeAllListeners(event?: keyof T): void {
    if (event) {
      this.eventListeners.delete(event)
    } else {
      this.eventListeners.clear()
    }
  }
}
