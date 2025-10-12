import { DefaultLogger, StyleBlue } from '../core/Logger'
import { EventEmitter } from '../core/EventEmitter'
import { InputCapabilities } from '../types/index'
import { ConversationNetwork } from '../network/ConversationNetwork'
import { AudioRecorder, AudioRecordingConfig, AudioRecorderEvents } from './AudioRecorder'
import {
  IVADManager,
  UserInputManagerEvents,
  VadManagerEvents,
  VADVoiceActivityEvent,
} from './types'

/**
 * Manages user input for conversations
 *
 * Supports different types of input:
 * - audio: Voice/audio input through microphone
 * - text: Text input through sendText() method
 **/
export class UserInputManager extends EventEmitter {
  private audioRecorder: AudioRecorder | null = null
  private isStopped = true
  private mediaStream: MediaStream | null = null

  private isInputCompleteSent = false

  constructor(
    private capabilities: InputCapabilities,
    private vadManager: IVADManager,
    private network: ConversationNetwork,
    private recordingConfig?: AudioRecordingConfig
  ) {
    const logger = new DefaultLogger({ category: '🎩 UserInputManager', style: StyleBlue })
    super(logger)
    this.setupListeners()

    if (this.capabilities.audio) {
      this.audioRecorder = new AudioRecorder(recordingConfig)
      this.setupRecorderListeners()
    }
  }

  async initialize(mediaStream?: MediaStream): Promise<void> {
    await this.reinitializeAudio(mediaStream)
  }

  async reinitializeAudio(mediaStream?: MediaStream): Promise<void> {
    if (this.capabilities.audio) {
      if (mediaStream) {
        this.mediaStream = mediaStream
      }

      if (!this.mediaStream) {
        const constraints: MediaTrackConstraints = {
          echoCancellation: this.recordingConfig?.echoCancellation,
          noiseSuppression: this.recordingConfig?.noiseSuppression,
          autoGainControl: this.recordingConfig?.autoGainControl,
          sampleRate: this.recordingConfig?.sampleRate,
          channelCount: this.recordingConfig?.channels,
        }
        Object.keys(constraints).forEach(
          (key) =>
            constraints[key as keyof MediaTrackConstraints] === undefined &&
            delete constraints[key as keyof MediaTrackConstraints]
        )
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      }
      await this.vadManager.initialize(this.mediaStream)
      await this.audioRecorder?.initialize(this.mediaStream)
    }
  }

  async start(): Promise<void> {
    if (this.isStopped) {
      this.isStopped = false
      if (this.capabilities.audio) {
        this.vadManager.startAnalysis()
        await this.startRecording()
      }
    }
  }

  async stop(): Promise<boolean> {
    if (this.isStopped) {
      return false
    }
    this.logger.debug('Stopping User Input...')
    this.isStopped = true
    if (this.capabilities.audio) {
      this.vadManager.stopAnalysis()
      await this.stopRecording()
    }
    return true
  }

  async updateCapabilities(capabilities: InputCapabilities): Promise<void> {
    this.capabilities = capabilities
    this.logger.debug('Input capabilities updated', this.capabilities)
    if (this.capabilities.audio && !this.audioRecorder) {
      this.audioRecorder = new AudioRecorder(this.recordingConfig)
      this.setupRecorderListeners()
      await this.reinitializeAudio()
    } else if (!this.capabilities.audio && this.audioRecorder) {
      await this.audioRecorder.stop()
      this.audioRecorder = null
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop())
        this.mediaStream = null
      }
    }
  }

  async stopRecording(): Promise<void> {
    if (this.capabilities.audio && this.audioRecorder?.isRecording()) {
      await this.audioRecorder.stop()
    }
  }

  private async startRecording(): Promise<void> {
    if (this.capabilities.audio && this.audioRecorder) {
      if (!this.audioRecorder.isInitialized()) {
        this.logger.warn('AudioRecorder not initialized, reinitializing...')
        await this.reinitializeAudio()
      }
      await this.audioRecorder.start()
    } else {
      this.logger.info(
        'Will not start recording, audio capabilities are not enabled or audio recorder is not initialized'
      )
    }
  }

  isRecording(): boolean {
    return this.capabilities.audio && (this.audioRecorder?.isRecording() || false)
  }

  enableAudioBuffering(): void {
    if (this.capabilities.audio && this.audioRecorder) {
      this.audioRecorder.enableBufferingMode()
    }
  }

  disableAudioBuffering(): void {
    if (this.capabilities.audio && this.audioRecorder) {
      this.audioRecorder.disableBufferingMode()
    }
  }

  getBufferedAudio(): ArrayBuffer[] {
    return this.audioRecorder?.getBufferedAudio() || []
  }

  clearAudioBuffer(): void {
    if (this.capabilities.audio && this.audioRecorder) {
      this.audioRecorder.clearBuffer()
    }
  }

  async flushBufferedAudio() {
    const bufferedAudio = this.getBufferedAudio()
    if (bufferedAudio.length > 0) {
      this.logger.debug(`Flushing ${bufferedAudio.length} buffered audio chunks`)
      for (const audioChunk of bufferedAudio) {
        await this.sendAudio(audioChunk)
      }
    }
    this.clearAudioBuffer()
    this.disableAudioBuffering()
  }

  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    if (this.isStopped) return
    this.logger.debug('sendAudio called, size:', audioData.byteLength)
    const base64 = this.arrayBufferToBase64(audioData)
    await this.network.addAudio(base64)
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  async sendText(text: string): Promise<void> {
    if (this.capabilities.text) {
      await this.network.interact(text)
    } else {
      this.logger.warn('Text input not supported by current capabilities', this.capabilities)
    }
  }

  async sendInputComplete(): Promise<void> {
    if (this.isStopped || this.isInputCompleteSent) return
    this.isInputCompleteSent = true
    await this.emit(UserInputManagerEvents.UserInput, { type: 'input_complete' })
  }

  reset(): void {
    this.isInputCompleteSent = false
  }

  private setupListeners(): void {
    if (this.capabilities.audio) {
      this.vadManager.on(VadManagerEvents.VoiceActivity, async (event?: VADVoiceActivityEvent) => {
        if (!event || this.isStopped) return
        if (event.isSpeaking) {
          await this.emit(UserInputManagerEvents.UserSpeaking)
        } else {
          await this.emit(UserInputManagerEvents.UserSilence)
        }
      })
      this.vadManager.on(VadManagerEvents.Silence, async () => {
        await this.sendInputComplete()
        await this.network.checkTurn()
      })
    }
  }

  private setupRecorderListeners(): void {
    if (!this.audioRecorder) return

    this.audioRecorder.on(AudioRecorderEvents.AudioData, async (audioData: ArrayBuffer) => {
      await this.sendAudio(audioData)
    })
  }

  async resumeAudioContext(): Promise<void> {
    if (this.capabilities.audio && this.audioRecorder) {
      await this.audioRecorder.resumeAudioContext()
    }
  }
}
