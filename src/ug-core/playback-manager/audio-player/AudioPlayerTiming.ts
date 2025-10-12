import { EventEmitter } from '../../core/EventEmitter'
import { DefaultLogger, StyleTeal } from '../../core/Logger'

export class AudioPlayerTimingEvents {
  static AboutToComplete = 'about-to-complete' as const
}

export type AudioPlayerTimingEventType =
  (typeof AudioPlayerTimingEvents)[keyof typeof AudioPlayerTimingEvents]

export type AudioPlayerTimingEventHandlers = {
  [AudioPlayerTimingEvents.AboutToComplete]: () => void
}

/**
 * Responsible to track audio player and emit events when certain things happened
 * such as audio about to complete event
 */
export class AudioPlayerTiming extends EventEmitter<AudioPlayerTimingEventHandlers> {
  private aboutToCompleteThresholdMs: number
  private hasTriggeredAboutToComplete = false
  private aboutToCompleteTimer: number | null = null
  private isAudioComplete = false

  constructor(
    private getCurrentTime: () => number,
    private getQueueLength: () => number,
    private getQueueDuration: () => number,
    aboutToCompleteThresholdMs: number
  ) {
    const logger = new DefaultLogger({ category: '🎵 AudioPlayerTiming', style: StyleTeal })
    super(logger)
    this.aboutToCompleteThresholdMs = aboutToCompleteThresholdMs
  }

  onAudioComplete(): void {
    this.isAudioComplete = true
    this.checkAboutToComplete()
  }

  onAudioEnqueued(): void {
    // Check if we should trigger about-to-complete when new audio is added
    if (this.isAudioComplete && !this.hasTriggeredAboutToComplete) {
      this.checkAboutToComplete()
    }
  }

  private checkAboutToComplete(): void {
    if (this.hasTriggeredAboutToComplete || !this.isAudioComplete) {
      return
    }

    // Clear any existing timer
    if (this.aboutToCompleteTimer) {
      clearTimeout(this.aboutToCompleteTimer)
      this.aboutToCompleteTimer = null
    }

    // Get actual remaining duration from the queue
    const remainingDurationMs = this.getQueueDuration() * 1000 // Convert seconds to milliseconds
    this.logger.debug(
      `checkAboutToComplete: remainingDurationMs=${remainingDurationMs}, queueLength=${this.getQueueLength()}`
    )

    if (remainingDurationMs === 0) {
      // If no audio in queue, we're already at the end
      this.triggerAboutToComplete()
      return
    }

    this.logger.debug(
      `Remaining audio duration: ${remainingDurationMs}ms, threshold: ${this.aboutToCompleteThresholdMs}ms`
    )

    if (remainingDurationMs <= this.aboutToCompleteThresholdMs) {
      // We're already within the threshold, trigger immediately
      this.triggerAboutToComplete()
    } else {
      // Set a timer to trigger when we're close to completion
      const timerDelay = remainingDurationMs - this.aboutToCompleteThresholdMs
      this.logger.debug(`Setting timer for ${timerDelay}ms`)
      this.aboutToCompleteTimer = window.setTimeout(() => {
        this.triggerAboutToComplete()
      }, timerDelay)
    }
  }

  private async triggerAboutToComplete(): Promise<void> {
    if (this.hasTriggeredAboutToComplete) {
      return
    }

    this.hasTriggeredAboutToComplete = true
    this.logger.debug(`Audio about to complete (${this.aboutToCompleteThresholdMs}ms threshold)`)
    await this.emit(AudioPlayerTimingEvents.AboutToComplete)
  }

  reset(): void {
    this.hasTriggeredAboutToComplete = false
    this.isAudioComplete = false

    if (this.aboutToCompleteTimer) {
      clearTimeout(this.aboutToCompleteTimer)
      this.aboutToCompleteTimer = null
    }
  }
}
