import { EventEmitter } from '@/ug-core/core/EventEmitter'
import { DefaultLogger, StylePurple } from '@/ug-core/core/Logger'
import { IVADManager } from './types'
import type { SpeechProbabilities } from '@ricky0123/vad-web/dist/models'
import type { VADVoiceActivityEvent } from './types'
import { MicVAD } from '@ricky0123/vad-web'

export const VadManagerEvents = {
  VoiceActivity: 'voiceActivity',
  Silence: 'silence',
} as const

export class VADManager extends EventEmitter implements IVADManager {
  private vadModel: any = null
  private silenceTimer: number | null = null
  private silenceTimeoutMs: number
  private positiveSpeechThreshold: number
  private negativeSpeechThreshold: number
  private minSpeechFrames: number

  constructor(
    silenceTimeoutMs: number = 300,
    positiveSpeechThreshold: number = 0.5,
    negativeSpeechThreshold: number = 0.35,
    minSpeechFrames: number = 3
  ) {
    const logger = new DefaultLogger({ category: '🎤 VADManager', style: StylePurple })
    super(logger)
    this.silenceTimeoutMs = silenceTimeoutMs
    this.positiveSpeechThreshold = positiveSpeechThreshold
    this.negativeSpeechThreshold = negativeSpeechThreshold
    this.minSpeechFrames = minSpeechFrames
  }

  /**
   * Initialize the VAD model. Optionally accepts a MediaStream to avoid mic conflicts.
   * If stream is provided, it will be used by MicVAD; otherwise, MicVAD will acquire its own.
   */
  async initialize(stream: MediaStream): Promise<void> {
    this.logger.debug('You may need to close the browser console for this to initialize')
    this.vadModel = await MicVAD.new({
      stream,
      baseAssetPath: '/static/binaries/', // Serve those locally
      onnxWASMBasePath: '/static/binaries/', // Serve those locally
      positiveSpeechThreshold: this.positiveSpeechThreshold,
      negativeSpeechThreshold: this.negativeSpeechThreshold,
      minSpeechFrames: this.minSpeechFrames,
      onSpeechStart: async () => {
        this.logger.debug('Speech started')
        this.clearSilenceTimer()
        const event: VADVoiceActivityEvent = { isSpeaking: true, confidence: 1.0 }
        await this.emit(VadManagerEvents.VoiceActivity, event)
      },
      onSpeechEnd: async (audio: Float32Array) => {
        this.logger.debug('Speech ended')
        this.startSilenceTimer()
        const event: VADVoiceActivityEvent = { isSpeaking: false, confidence: 1.0 }
        await this.emit(VadManagerEvents.VoiceActivity, event)
      },
      onVADMisfire: async () => {
        this.logger.debug('Misfire detected')
        const event: VADVoiceActivityEvent = { isSpeaking: false, confidence: 0.0, misfire: true }
        await this.emit(VadManagerEvents.VoiceActivity, event)
      },
      onFrameProcessed: async (probs: SpeechProbabilities) => {
        // Optionally emit VAD probability for debug
        // await this.emit('vadProb', probs.isSpeech)
      },
    })
    this.logger.debug(
      `VAD Manager initialized (MicVAD) with silenceTimeoutMs=${this.silenceTimeoutMs}, positiveSpeechThreshold=${this.positiveSpeechThreshold}, negativeSpeechThreshold=${this.negativeSpeechThreshold}, minSpeechFrames=${this.minSpeechFrames}`
    )
  }

  startAnalysis(): void {
    if (this.vadModel) {
      this.vadModel.start()
      this.logger.debug('VAD analysis started (MicVAD)')
    }
  }

  stopAnalysis(): void {
    this.clearSilenceTimer()
    if (this.vadModel) {
      this.vadModel.pause()
      this.logger.debug('VAD analysis stopped (MicVAD)')
    }
  }

  startSilenceTimer(): void {
    if (this.silenceTimer) return
    this.silenceTimer = window.setTimeout(async () => {
      await this.emit(VadManagerEvents.Silence)
      this.silenceTimer = null
    }, this.silenceTimeoutMs)
  }

  clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }
}
