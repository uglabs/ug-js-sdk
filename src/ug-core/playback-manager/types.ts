import { EventEmitter } from '@/ug-core/core/EventEmitter'
import { Message } from '../types'

export class AudioPlayerEvents {
  static Playing = 'playing'
  static Paused = 'paused'
  static Stopped = 'stopped'
  static Enqueued = 'enqueued'
  static Error = 'error'
  static Ready = 'ready'
  static Finished = 'finished'
  static AboutToComplete = 'aboutToComplete'
}

export class VisemeSchedulerEvents {
  static Paused = 'paused'
  static Playing = 'playing'
  static Viseme = 'viseme'
}

export class AvatarManagerEvents {
  static AnimationStopped = 'animation-stopped'
  static AnimationChanged = 'animation-changed'
}

export interface IAudioPlayer extends EventEmitter {
  initialize(): void
  enqueue(audioData: string): void
  getCurrentTime(): number
  getQueueLength(): number
  getQueueDuration(): number
  play(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  reset(): void
  markComplete(): void
  resetAboutToComplete(): void
}
export interface IAvatar {
  playAnimation(name: string, layer?: number): void
  stopAnimation(layer?: number): void
  on(event: string, callback: Function): void
  playIdle(): void
  playListen(): void
  playTalk(): void
  playThink(): void
  playLaugh(): void
  playWaving(): void
  playViseme(visemeName: string): void
}

export interface VisemeMessage {
  type: 'viseme'
  viseme: any
  start_times_ms: number[]
  durations_ms: number[]
}

export interface AudioMessage {
  type: 'audio'
  audio: string
}

export interface AudioCompleteMessage extends Message {
  type: 'audio_complete'
}
export interface SubtitleMessage {
  type: 'subtitles'
  characters: string[]
  start_times_ms: number[]
  durations_ms: number[]
  wordBoundaries?: Array<{ start: number; end: number }>
}

export interface WordBoundary {
  start: number
  end: number
}

export interface WordHighlightEvent {
  globalWordIndex: number
  currentLineIndex: number
  wordIndexInLine: number
  word?: string
  currentLineData: {
    characters: string[]
    wordBoundaries: WordBoundary[]
  } | null
  nextLineData: {
    characters: string[]
    wordBoundaries: WordBoundary[]
  } | null
}

export interface SubtitleChangeEvent {
  currentLine: {
    characters: string[]
    wordBoundaries: WordBoundary[]
    adjustedWordStartTimesMs: number[]
  } | null
  nextLine: {
    characters: string[]
    wordBoundaries: WordBoundary[]
    adjustedWordStartTimesMs: number[]
  } | null
}

export interface ImageChangeEvent {
  format: string
  image: string
}
