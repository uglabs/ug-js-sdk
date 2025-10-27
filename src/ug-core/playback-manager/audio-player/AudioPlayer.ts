import { EventEmitter } from '../../core/EventEmitter'
import { DefaultLogger, StyleGreen } from '../../core/Logger'
import { AudioPlayerEvents, IAudioPlayer } from '../types'
import { MP3FrameExtractor } from './MP3FrameExtractor'
import { AudioPlayerTiming } from './AudioPlayerTiming'

export class AudioPlayer extends EventEmitter implements IAudioPlayer {
  private readonly MIN_CHUNKS_TO_PROCESS = 2
  private readonly FLUSH_DELAY_MS = 450
  private audioContext: AudioContext
  private currentSource: AudioBufferSourceNode | null = null
  private playbackQueue: AudioBuffer[] = []

  // Timing-related properties
  private scheduledPlayTime = 0 // The audioContext's time for the next buffer to be scheduled
  private playbackStartTime = 0 // The audioContext's time when the current playback session started

  // New fields for chunked playback
  private chunkQueue: Array<{ base64String: string }> = []
  private isProcessingQueue = false
  private frameExtractor = new MP3FrameExtractor()
  private pendingData: Uint8Array | null = null
  private isPlayingState = false
  private isPausedState = false
  private stopped = false
  private frameBuffer: Uint8Array[] = []
  private chunkAccumulator: string[] = []
  private flushTimeout: ReturnType<typeof setTimeout> | null = null
  private isAudioComplete = false
  private timing: AudioPlayerTiming
  private isScheduling = false // Lock to prevent concurrent scheduling runs
  private allAudioPlayed = false // Flag to handle race condition

  constructor() {
    const logger = new DefaultLogger({ category: '🎵 AudioPlayer', style: StyleGreen })
    super(logger)

    this.audioContext = new AudioContext()
    this.timing = new AudioPlayerTiming(
      () => this.getCurrentTime(),
      () => this.getQueueLength(),
      () => this.getQueueDuration(),
      1000 // about To Complete Threshold Ms
    )
    this.setupTimingListeners()
  }

  private setupTimingListeners(): void {
    this.timing.on('about-to-complete', async () => {
      await this.emit(AudioPlayerEvents.AboutToComplete)
    })
  }

  public initialize(): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      this.logger.debug('AudioContext created by user gesture')
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
      this.logger.debug('AudioContext resumed by user gesture')
    }
    this.resetState()
  }

  private resetState(): void {
    if (this.currentSource) {
      this.currentSource.onended = null
      this.currentSource.stop()
      this.currentSource = null
    }
    this.playbackQueue = []
    this.scheduledPlayTime = 0
    this.playbackStartTime = 0
    this.chunkQueue = []
    this.isProcessingQueue = false
    this.pendingData = null
    this.isPlayingState = false
    this.isPausedState = false
    this.stopped = false
    this.frameBuffer = []
    this.chunkAccumulator = []
    this.isAudioComplete = false
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = null
    }
    this.timing.reset()
    this.allAudioPlayed = false
  }

  public reset(): void {
    this.resetState()
  }

  enqueue(audioData: string): void {
    this.logger.debug('Enqueue: received chunk')
    this.allAudioPlayed = false
    this.chunkQueue.push({ base64String: audioData })
    this.processChunkQueue()

    if (!this.isAudioComplete) {
      if (this.flushTimeout) clearTimeout(this.flushTimeout)
      this.flushTimeout = setTimeout(() => {
        this.logger.debug('auto-flush timer fired')
        this.flush()
      }, this.FLUSH_DELAY_MS)
    }
  }

  markComplete(): void {
    this.logger.debug('markComplete: no more audio will be added')
    this.isAudioComplete = true
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = null
    }
    this.timing.onAudioComplete()
    this.flush()

    if (this.allAudioPlayed) {
      this.logger.debug('markComplete: All audio was already played, emitting Finished.')
      this.isPlayingState = false
      this.emit(AudioPlayerEvents.Finished)
    }
  }

  private async processChunkQueue(): Promise<void> {
    if (this.isProcessingQueue) return
    this.isProcessingQueue = true
    try {
      while (this.chunkQueue.length > 0) {
        const { base64String } = this.chunkQueue.shift()!
        this.chunkAccumulator.push(base64String)
        if (this.chunkAccumulator.length >= this.MIN_CHUNKS_TO_PROCESS) {
          const chunksToProcess = this.chunkAccumulator
          this.chunkAccumulator = []
          await this.decodeAndEnqueueChunks(chunksToProcess)
        }
      }
    } finally {
      this.isProcessingQueue = false
    }
  }

  private decodeBase64ToUint8Array(base64String: string): Uint8Array {
    const binary =
      typeof atob !== 'undefined'
        ? atob(base64String)
        : Buffer.from(base64String, 'base64').toString('binary')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  private combineArrays(first: Uint8Array, second: Uint8Array): Uint8Array {
    const combined = new Uint8Array(first.length + second.length)
    combined.set(first)
    combined.set(second, first.length)
    return combined
  }

  private async decodeAudioFrames(frames: Uint8Array[]): Promise<AudioBuffer | null> {
    const totalLength = frames.reduce((sum, arr) => sum + arr.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of frames) {
      combined.set(arr, offset)
      offset += arr.length
    }
    return new Promise((resolve, reject) => {
      const arrayBuffer = combined.buffer.slice(
        combined.byteOffset,
        combined.byteOffset + combined.byteLength
      )
      this.audioContext.decodeAudioData(
        arrayBuffer as ArrayBuffer,
        (audioBuffer) => resolve(audioBuffer),
        (error) => reject(error)
      )
    })
  }

  async play(): Promise<void> {
    if (this.isPlayingState || this.playbackQueue.length === 0) {
      this.logger.debug('Play called but already playing or queue is empty.')
      return
    }
    this.isPlayingState = true
    this.stopped = false
    this.isPausedState = false

    if (this.isPausedState) {
      this.scheduledPlayTime = this.audioContext.currentTime
    } else {
      this.scheduledPlayTime = this.audioContext.currentTime
      this.playbackStartTime = this.audioContext.currentTime
    }

    this.logger.debug(`Playback starting. Start time: ${this.playbackStartTime}`)
    this.schedulePlayback()
    await this.emit(AudioPlayerEvents.Playing)
  }

  private schedulePlayback(): void {
    if (this.isScheduling || this.playbackQueue.length === 0 || this.stopped) {
      return
    }
    this.isScheduling = true

    // If there's an existing "last source", its onended handler is now obsolete
    // as we are about to add more audio and set a new onended handler.
    if (this.currentSource) {
      this.currentSource.onended = null
    }

    let lastSource: AudioBufferSourceNode | null = null

    while (this.playbackQueue.length > 0) {
      const buffer = this.playbackQueue.shift()!
      const source = this.audioContext.createBufferSource()
      source.buffer = buffer
      source.connect(this.audioContext.destination)

      if (this.scheduledPlayTime < this.audioContext.currentTime) {
        this.logger.debug(
          `Adjusting scheduledPlayTime from ${this.scheduledPlayTime} to current time ${this.audioContext.currentTime}`
        )
        this.scheduledPlayTime = this.audioContext.currentTime
      }

      this.logger.debug(
        `Scheduling buffer of duration ${buffer.duration}s to start at ${this.scheduledPlayTime} (context time: ${this.audioContext.currentTime})`
      )
      source.start(this.scheduledPlayTime)
      this.scheduledPlayTime += buffer.duration
      lastSource = source
    }

    if (lastSource) {
      this.currentSource = lastSource
      lastSource.onended = () => {
        this.logger.debug(
          `Buffer finished playing. Context time: ${this.audioContext.currentTime}, isPaused: ${this.isPausedState}, stopped: ${this.stopped}`
        )
        if (this.stopped || this.isPausedState) return

        // This specific buffer has finished.
        // Check if more have arrived in the meantime.
        if (this.playbackQueue.length > 0) {
          this.logger.debug('More buffers in queue, scheduling next batch.')
          this.schedulePlayback() // Schedule the new batch
        } else if (this.isAudioComplete) {
          this.logger.debug('Last scheduled audio buffer finished and audio is complete.')
          this.isPlayingState = false
          this.emit(AudioPlayerEvents.Finished)
        } else {
          this.logger.debug('All scheduled audio has been played, but not marked as complete yet.')
          this.allAudioPlayed = true
        }
      }
    }

    this.isScheduling = false
  }

  async pause(): Promise<void> {
    if (this.currentSource && this.isPlayingState) {
      this.isPausedState = true
      this.isPlayingState = false
      this.audioContext.suspend()
      await this.emit(AudioPlayerEvents.Paused)
    }
  }

  async resume(): Promise<void> {
    if (this.isPausedState) {
      this.logger.debug('Resume called, restarting playback.')
      this.isPausedState = false
      this.isPlayingState = true
      this.audioContext.resume()
      this.play()
      await this.emit(AudioPlayerEvents.Playing)
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.resetState()
    await this.emit(AudioPlayerEvents.Stopped)
  }

  getCurrentTime(): number {
    if (!this.isPlayingState) {
      return 0
    }
    return (this.audioContext.currentTime - this.playbackStartTime) * 1000
  }

  getQueueLength(): number {
    return this.playbackQueue.length
  }

  getQueueDuration(): number {
    const queueDuration = this.playbackQueue.reduce((total, buffer) => total + buffer.duration, 0)
    let remainingTimeOfScheduled = 0
    if (this.isPlayingState && this.scheduledPlayTime > 0) {
      remainingTimeOfScheduled = Math.max(0, this.scheduledPlayTime - this.audioContext.currentTime)
    }
    return queueDuration + remainingTimeOfScheduled
  }

  private async decodeAndEnqueueChunks(chunks: string[]): Promise<void> {
    if (chunks.length === 0) {
      this.logger.debug('decodeAndEnqueueChunks: no chunks to decode')
      return
    }
    let allFrames: Uint8Array[] = []
    let pendingData: Uint8Array | null = this.pendingData
    for (const chunk of chunks) {
      const chunkData = this.decodeBase64ToUint8Array(chunk)
      const combinedData = pendingData ? this.combineArrays(pendingData, chunkData) : chunkData
      const { frames, remainingData } =
        this.frameExtractor.feedAndExtractCompleteFrames(combinedData)
      allFrames = allFrames.concat(frames)
      pendingData = remainingData.length > 0 ? remainingData : null
    }
    this.pendingData = pendingData
    this.logger.debug('decodeAndEnqueueChunks: total frames to decode', allFrames.length)
    if (allFrames.length > 0) {
      try {
        const audioBuffer = await this.decodeAudioFrames(allFrames)
        if (audioBuffer) {
          const wasEmpty = this.playbackQueue.length === 0
          this.playbackQueue.push(audioBuffer)
          await this.emit(AudioPlayerEvents.Enqueued, { duration: audioBuffer.duration })
          this.logger.debug(
            'decodeAndEnqueueChunks: enqueued audioBuffer, duration',
            audioBuffer.duration
          )
          this.timing.onAudioEnqueued()

          if (wasEmpty && !this.isPlayingState) {
            await this.emit(AudioPlayerEvents.Ready)
          } else if (this.isPlayingState) {
            this.schedulePlayback()
          }
        }
      } catch (error) {
        this.logger.error('Failed to decode audio frames', error)
        // We might have some empty frames where we cant decode. logging only to console and ignoring for now.
        // await this.emit(AudioPlayerEvents.Error, error)
      }
    } else {
      this.logger.debug('decodeAndEnqueueChunks: no frames to decode')
    }
  }

  public async flush(): Promise<void> {
    this.logger.debug('Flushing', { chunks: this.chunkAccumulator.length })
    const chunksToProcess = this.chunkAccumulator
    this.chunkAccumulator = []
    await this.decodeAndEnqueueChunks(chunksToProcess)
  }

  public resetAboutToComplete(): void {
    this.timing.reset()
  }
}
