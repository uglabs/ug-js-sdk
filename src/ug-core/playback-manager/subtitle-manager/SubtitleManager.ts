import { EventEmitter } from '../../core/EventEmitter'
import { DefaultLogger, StylePink } from '../../core/Logger'
import { SubtitleMessage, WordBoundary, WordHighlightEvent, SubtitleChangeEvent } from '../types'

export const SubtitleManagerEvents = {
  WordChange: 'wordChange',
  Playing: 'playing',
  Paused: 'paused',
  SubtitleFinished: 'subtitleFinished',
  SubtitleChange: 'subtitleChange',
} as const

interface EnhancedSubtitleMessage extends SubtitleMessage {
  wordBoundaries: WordBoundary[]
  wordStartTimesMs: number[]
  adjustedWordStartTimesMs?: number[]
}

interface SubtitleState {
  currentLine: EnhancedSubtitleMessage | null
  nextLine: EnhancedSubtitleMessage | null
  globalWordIndex: number
}

export class SubtitleManager extends EventEmitter {
  private getCurrentTime: () => number
  private subtitleQueue: EnhancedSubtitleMessage[] = []
  private rafId: number | null = null
  private isPlaying = false
  private cumulativeOffset = 0
  private tickDebugLast = 0
  private state: SubtitleState = {
    currentLine: null,
    nextLine: null,
    globalWordIndex: -1,
  }

  constructor(getCurrentTime: () => number) {
    super(new DefaultLogger({ category: '🎬 SubtitleManager', style: StylePink }))
    this.getCurrentTime = getCurrentTime
    this._resetState()
  }

  enqueue(subtitle: SubtitleMessage): void {
    this.logger.debug('Enqueue subtitle', {
      subtitle,
      queueLength: this.subtitleQueue.length,
    })

    const { wordBoundaries, wordStartTimesMs } = this._computeWordBoundariesAndStartTimes(
      subtitle.characters,
      subtitle.start_times_ms
    )

    const enhanced: EnhancedSubtitleMessage = {
      ...subtitle,
      wordBoundaries,
      wordStartTimesMs,
    }

    this.subtitleQueue.push(enhanced)

    if (!this.isPlaying && this.subtitleQueue.length === 1) {
      this.logger.debug('Reset globalWordIndex to -1 (initial enqueue)')
      this.state.globalWordIndex = -1
    }

    // If we're already playing and a new subtitle arrives that could be the
    // "next" line, we need to update our state and inform the UI.
    if (this.isPlaying && !this.state.nextLine && this.subtitleQueue.length > 1) {
      this._prepareState()
      this._emitSubtitleChange()
    }
  }

  async play(): Promise<void> {
    if (this.isPlaying) {
      this.logger.debug('Play called but already playing')
      return
    }

    this.logger.debug('Play called, starting playback')
    this.isPlaying = true
    await this.emit(SubtitleManagerEvents.Playing)

    if (this.subtitleQueue.length > 0) {
      this._prepareState()
      await this._emitSubtitleChange()
    }

    this.rafId = requestAnimationFrame(this._tick)
  }

  async pause(): Promise<void> {
    this.logger.debug('Pause called')
    this.isPlaying = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    await this.emit(SubtitleManagerEvents.Paused)
  }

  clearQueue(): void {
    this.logger.debug('Clear queue')
    this._resetState()
    this.pause()
  }

  reset(): void {
    this._resetState()
  }

  private _resetState(): void {
    this.subtitleQueue = []
    this.cumulativeOffset = 0
    this.rafId = null
    this.isPlaying = false
    this.tickDebugLast = 0
    this.state = {
      currentLine: null,
      nextLine: null,
      globalWordIndex: -1,
    }
  }

  private _subtitleDuration(subtitle: EnhancedSubtitleMessage): number {
    const { start_times_ms, durations_ms } = subtitle
    if (!start_times_ms.length || !durations_ms.length) return 0
    const last = start_times_ms.length - 1
    return start_times_ms[last] + durations_ms[last]
  }

  private _applyOffset(times: number[], offset: number): number[] {
    return times.map((t) => t + offset)
  }

  private _prepareState(): void {
    if (!this.subtitleQueue.length) return

    const current = this.subtitleQueue[0]
    current.adjustedWordStartTimesMs = this._applyOffset(
      current.wordStartTimesMs,
      this.cumulativeOffset
    )

    const next = this.subtitleQueue[1] || null
    if (next) {
      const nextOffset = this.cumulativeOffset + this._subtitleDuration(current)
      next.adjustedWordStartTimesMs = this._applyOffset(next.wordStartTimesMs, nextOffset)
    }

    this.state.currentLine = current
    this.state.nextLine = next

    this.logger.debug('Prepared state', {
      cumulativeOffset: this.cumulativeOffset,
      hasCurrentLine: !!current,
      hasNextLine: !!next,
      firstFewAdjusted: current.adjustedWordStartTimesMs?.slice(0, 3),
    })
  }

  private _computeWordBoundariesAndStartTimes(characters: string[], charStartTimes: number[]) {
    const wordBoundaries: WordBoundary[] = []
    const wordStartTimesMs: number[] = []
    let wordStart: number | null = null

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i]

      if (char !== ' ' && wordStart === null) {
        wordStart = i
      }

      const isEndOfWord = (char === ' ' || i === characters.length - 1) && wordStart !== null
      if (isEndOfWord) {
        const endIdx = char === ' ' ? i - 1 : i
        wordBoundaries.push({ start: wordStart!, end: endIdx! })
        wordStartTimesMs.push(charStartTimes[wordStart!])
        wordStart = null
      }
    }

    return { wordBoundaries, wordStartTimesMs }
  }

  private _calculateGlobalWordIndex(currentTimeMs: number): number {
    let idx = -1
    const { currentLine, nextLine } = this.state

    if (currentLine?.adjustedWordStartTimesMs) {
      for (let i = 0; i < currentLine.adjustedWordStartTimesMs.length; i++) {
        if (currentTimeMs >= currentLine.adjustedWordStartTimesMs[i]) idx = i
        else break
      }
    }

    if (nextLine?.adjustedWordStartTimesMs) {
      const offset = currentLine?.wordBoundaries.length || 0
      for (let i = 0; i < nextLine.adjustedWordStartTimesMs.length; i++) {
        if (currentTimeMs >= nextLine.adjustedWordStartTimesMs[i]) idx = offset + i
        else break
      }
    }

    return idx
  }

  private _decodeGlobalIndex(globalIndex: number): { lineIndex: number; wordIndex: number } {
    if (globalIndex < 0) return { lineIndex: 0, wordIndex: -1 }
    const currentCount = this.state.currentLine?.wordBoundaries.length || 0
    return globalIndex < currentCount
      ? { lineIndex: 0, wordIndex: globalIndex }
      : { lineIndex: 1, wordIndex: globalIndex - currentCount }
  }

  private _isFinished(
    sub: EnhancedSubtitleMessage,
    currentTimeMs: number,
    offset: number
  ): boolean {
    return currentTimeMs > offset + this._subtitleDuration(sub)
  }

  // ---------------------- Event Builders ----------------------

  private _buildWordChangeEvent(globalWordIndex: number): WordHighlightEvent {
    const { lineIndex, wordIndex } = this._decodeGlobalIndex(globalWordIndex)
    const { currentLine, nextLine } = this.state

    const buildLineData = (line: EnhancedSubtitleMessage | null) =>
      line
        ? {
            characters: line.characters,
            wordBoundaries: line.wordBoundaries,
          }
        : null

    let word: string | undefined

    if (lineIndex === 0 && currentLine && wordIndex >= 0) {
      const b = currentLine.wordBoundaries[wordIndex]
      word = currentLine.characters.slice(b.start, b.end + 1).join('')
    } else if (lineIndex === 1 && nextLine && wordIndex >= 0) {
      const b = nextLine.wordBoundaries[wordIndex]
      word = nextLine.characters.slice(b.start, b.end + 1).join('')
    }

    return {
      globalWordIndex,
      currentLineIndex: lineIndex,
      wordIndexInLine: wordIndex,
      word,
      currentLineData: buildLineData(currentLine),
      nextLineData: buildLineData(nextLine),
    }
  }

  private _buildSubtitleChangeEvent(): SubtitleChangeEvent {
    const build = (line: EnhancedSubtitleMessage | null) =>
      line?.adjustedWordStartTimesMs
        ? {
            characters: line.characters,
            wordBoundaries: line.wordBoundaries,
            adjustedWordStartTimesMs: line.adjustedWordStartTimesMs,
          }
        : null

    return {
      currentLine: build(this.state.currentLine),
      nextLine: build(this.state.nextLine),
    }
  }

  // ---------------------- Emitters ----------------------

  private async _emitWordChange(globalWordIndex: number): Promise<void> {
    const event = this._buildWordChangeEvent(globalWordIndex)
    this.logger.debug('Word change', {
      globalWordIndex,
      lineIndex: event.currentLineIndex,
      wordIndex: event.wordIndexInLine,
      word: event.word,
    })
    await this.emit(SubtitleManagerEvents.WordChange, event)
  }

  private async _emitSubtitleChange(): Promise<void> {
    const event = this._buildSubtitleChangeEvent()
    this.logger.debug('Subtitle change', {
      hasCurrentLine: !!event.currentLine,
      hasNextLine: !!event.nextLine,
    })
    await this.emit(SubtitleManagerEvents.SubtitleChange, event)
  }

  // ---------------------- Main Loop ----------------------

  private _tick = async () => {
    if (!this.isPlaying || this.subtitleQueue.length === 0) return

    // If a new subtitle has been added to the queue (e.g., for the next line),
    // we need to re-prepare the state and notify the UI.
    if (!this.state.nextLine && this.subtitleQueue.length > 1) {
      this._prepareState()
      await this._emitSubtitleChange()
    }

    const currentTimeMs = this.getCurrentTime()
    if (!this.state.currentLine) this._prepareState()

    // Throttled debug
    if (currentTimeMs - this.tickDebugLast >= 3000) {
      this.logger.debug('Tick debug', {
        currentTimeMs,
        cumulativeOffset: this.cumulativeOffset,
        hasCurrentLine: !!this.state.currentLine,
        hasNextLine: !!this.state.nextLine,
      })
      this.tickDebugLast = currentTimeMs
    }

    const newGlobal = this._calculateGlobalWordIndex(currentTimeMs)
    if (newGlobal !== this.state.globalWordIndex) {
      this.state.globalWordIndex = newGlobal
      await this._emitWordChange(newGlobal)
    }

    const current = this.subtitleQueue[0]
    const next = this.subtitleQueue[1] || null

    let advance = 0
    if (next) {
      const nextOffset = this.cumulativeOffset + this._subtitleDuration(current)
      if (this._isFinished(next, currentTimeMs, nextOffset)) advance = 2
    } else if (current && this._isFinished(current, currentTimeMs, this.cumulativeOffset)) {
      advance = 1
    }

    if (advance > 0) {
      this.logger.debug(`Subtitle batch finished. Advancing ${advance} lines.`, {
        currentTimeMs,
        cumulativeOffset: this.cumulativeOffset,
      })

      const finished = this.subtitleQueue.splice(0, advance)
      for (const sub of finished) {
        this.cumulativeOffset += this._subtitleDuration(sub)
        await this.emit(SubtitleManagerEvents.SubtitleFinished, sub)
      }

      if (this.subtitleQueue.length > 0) {
        this._prepareState()
        await this._emitSubtitleChange()
      } else {
        this.logger.debug('Queue empty, pausing')
        this.state.globalWordIndex = -1
        await this._emitWordChange(-1)
        await this.pause()
        return
      }
    }

    this.rafId = requestAnimationFrame(this._tick)
  }
}
