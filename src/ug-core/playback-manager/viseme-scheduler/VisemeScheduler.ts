import { EventEmitter } from '../../core/EventEmitter'
import { DefaultLogger, StyleRed } from '../../core/Logger'
import { VisemeMessage, VisemeSchedulerEvents } from '../types'

export class VisemeScheduler extends EventEmitter {
  private scheduledEvents: VisemeMessage[] = []
  private masterClock: AudioContext

  constructor(audioContext: AudioContext) {
    const logger = new DefaultLogger({ category: '👄 VisemeScheduler', style: StyleRed })
    super(logger)
    this.masterClock = audioContext
  }

  enqueue(visemes: VisemeMessage[]): void {
    this.scheduledEvents.push(...visemes)
    this.scheduleEvents()
  }

  async play(): Promise<void> {
    await this.emit(VisemeSchedulerEvents.Playing)
  }

  async pause(): Promise<void> {
    await this.emit(VisemeSchedulerEvents.Paused)
  }

  private scheduleEvents(): void {
    const currentTime = this.masterClock.currentTime

    this.scheduledEvents.forEach((event) => {
      setTimeout(async () => {
        await this.emit(VisemeSchedulerEvents.Viseme, event)
      })
    })
  }
}
