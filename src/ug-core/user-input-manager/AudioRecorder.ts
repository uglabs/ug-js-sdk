import { EventEmitter } from '@/ug-core/core/EventEmitter'
import { DefaultLogger, StyleBrown } from '@/ug-core/core/Logger'
import { IAudioRecorder } from './types'
import { MediaRecorderFallback } from './MediaRecorderFallback'

// Event name constants
export const AudioRecorderEvents = {
  RecordingStarted: 'recording-started',
  RecordingStopped: 'recording-stopped',
  AudioData: 'audio-data',
  Error: 'error',
} as const

export interface AudioRecordingConfig {
  sampleRate?: number
  channels?: number
  bitDepth?: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

export interface AudioRecordingEvents {
  [AudioRecorderEvents.RecordingStarted]: () => void
  [AudioRecorderEvents.RecordingStopped]: () => void
  [AudioRecorderEvents.AudioData]: (data: ArrayBuffer) => void
  [AudioRecorderEvents.Error]: (error: Error) => void
}

export class AudioRecorder extends EventEmitter<AudioRecordingEvents> implements IAudioRecorder {
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private mediaRecorder: MediaRecorder | null = null
  private recording = false
  private config: Required<AudioRecordingConfig>
  private useMediaRecorder = false
  private mediaRecorderFallback: MediaRecorderFallback | null = null
  private audioBuffer: ArrayBuffer[] = []
  private bufferingMode = false

  private readonly MIME_TYPE = 'audio/webm;codecs=opus'

  constructor(config: AudioRecordingConfig = {}) {
    const logger = new DefaultLogger({ category: '🎤 AudioRecorder', style: StyleBrown })
    super(logger)
    this.config = {
      sampleRate: 41000,
      channels: 1,
      bitDepth: 16,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...config,
    }
  }

  async initialize(stream: MediaStream): Promise<void> {
    try {
      this.logger.debug('Initializing...')
      await this.setupAudioContext()
      await this.loadAudioWorklet()
      this.mediaStream = stream
      if (this.useMediaRecorder) {
        this.mediaRecorderFallback = new MediaRecorderFallback(
          this.MIME_TYPE,
          (data: ArrayBuffer) => this.handleAudioData(data)
        )
        this.mediaRecorderFallback.initialize(this.mediaStream)
      }
      this.logger.debug('Initialized successfully')
    } catch (error) {
      this.logger.error('Failed to initialize', error)
      throw error
    }
  }

  async start(): Promise<void> {
    if (this.recording) {
      this.logger.warn('Recording already in progress')
      return
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume()
        this.logger.debug('AudioContext resumed successfully at start of recording.')
      } catch (e) {
        this.logger.error('Failed to resume AudioContext:', e)
        const err = new Error(
          'The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page. https://developer.chrome.com/blog/autoplay/#web_audio'
        )
        await this.emit(AudioRecorderEvents.Error, err)
        throw err
      }
    }

    // Ensure AudioContext and worklet are initialized if they were cleaned up
    if (!this.audioContext) {
      await this.setupAudioContext()
      await this.loadAudioWorklet()
    }

    try {
      // Ensure AudioContext is resumed (needed for user interaction)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.logger.debug('Resuming AudioContext before starting recording...')
        await this.audioContext.resume()
      }
      if (!this.mediaStream) {
        throw new Error(
          'AudioRecorder: mediaStream must be set via initialize(stream) before starting recording.'
        )
      }
      this.logger.debug('setupMediaStream complete')
      await this.setupAudioProcessing()
      this.logger.debug('setupAudioProcessing complete')

      this.recording = true
      await this.emit(AudioRecorderEvents.RecordingStarted)
      this.logger.debug('Audio recording started')
    } catch (error) {
      this.logger.error('Failed to start recording', error)
      await this.emit(AudioRecorderEvents.Error, error as Error)
      throw error
    }
  }

  async stop(): Promise<void> {
    this.logger.debug('Stopping recording...')
    if (!this.recording) {
      this.logger.warn('No recording in progress')
      return
    }

    try {
      await this.cleanup()
      this.recording = false
      await this.emit(AudioRecorderEvents.RecordingStopped)
      this.logger.debug('Audio recording stopped')
    } catch (error) {
      this.logger.error('Failed to stop recording', error)
      await this.emit(AudioRecorderEvents.Error, error as Error)
      throw error
    }
  }

  isRecording(): boolean {
    return this.recording
  }

  enableBufferingMode(): void {
    this.logger.debug('Buffering mode enabled')
    this.bufferingMode = true
    this.audioBuffer = []
  }

  disableBufferingMode(): void {
    this.logger.debug('Buffering mode disabled')
    this.bufferingMode = false
  }

  getBufferedAudio(): ArrayBuffer[] {
    return [...this.audioBuffer]
  }

  clearBuffer(): void {
    const length = this.audioBuffer.length
    this.logger.debug(`Audio buffer cleared (Was ${length})`)
    this.audioBuffer = []
  }

  async resumeAudioContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.logger.debug('Resuming AudioContext...')
      await this.audioContext.resume()
      this.logger.debug('AudioContext resumed, state:', this.audioContext.state)
    }
  }

  private async setupMediaRecorder(): Promise<void> {
    this.logger.debug('Setting up MediaRecorder fallback...')
    this.useMediaRecorder = true
  }

  private async setupAudioContext(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
        latencyHint: 'interactive',
      })
      this.logger.debug('AudioContext created, state:', this.audioContext.state)
    }

    if (this.audioContext.state === 'suspended') {
      this.logger.debug('Resuming suspended AudioContext...')
      await this.audioContext.resume()
      this.logger.debug('AudioContext resumed, new state:', this.audioContext.state)
    }
  }

  private async loadAudioWorklet(): Promise<void> {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized')
    }
    return this.setupMediaRecorder()

    // The code below tries to use different method but causes some audio to be recorded as pcm

    // // Detect HTTP (not localhost) or Safari
    // const isHttp = window.location.protocol !== 'https:' && window.location.hostname !== 'localhost'
    // const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

    // if (isHttp || isSafari) {
    //   this.logger.warn('Using MediaRecorder fallback due to HTTP or Safari')
    //   return this.setupMediaRecorder()
    // }

    // try {
    //   this.logger.debug('Loading audio worklet...')

    //   // Check if AudioWorklet is supported
    //   if (!this.audioContext.audioWorklet) {
    //     this.logger.warn('AudioWorklet not supported, falling back to MediaRecorder (works on HTTP)')
    //     return this.setupMediaRecorder()
    //   }

    //   this.logger.debug('AudioWorklet API is available')
    //   this.logger.debug('AudioContext state:', this.audioContext.state)
    //   this.logger.debug('AudioContext sample rate:', this.audioContext.sampleRate)

    //   // Try to fetch the worklet file and load as blob
    //   try {
    //     this.logger.debug('Attempting to fetch worklet file...')
    //     const response = await fetch('/audio-recording-processor.js')
    //     if (!response.ok) {
    //       throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    //     }

    //     const workletContent = await response.text()
    //     this.logger.debug('Worklet file fetched successfully, creating blob...')

    //     // Create blob from the fetched content
    //     const blob = new Blob([workletContent], { type: 'application/javascript' })
    //     const blobUrl = URL.createObjectURL(blob)

    //     try {
    //       // Add timeout to prevent hanging
    //       const timeoutPromise = new Promise((_, reject) => {
    //         setTimeout(() => reject(new Error('Worklet loading timeout')), 5000)
    //       })

    //       await Promise.race([
    //         this.audioContext.audioWorklet.addModule(blobUrl),
    //         timeoutPromise
    //       ])

    //       this.logger.debug('Audio worklet loaded successfully from fetched file')

    //       // Verify the worklet was registered
    //       try {
    //         // This will throw if the worklet is not registered
    //         new AudioWorkletNode(this.audioContext, 'audio-recording-processor')
    //         this.logger.debug('Worklet registration verified')
    //       } catch (verifyError) {
    //         this.logger.error('Worklet registration verification failed:', verifyError)
    //         throw new Error('Worklet was loaded but not properly registered')
    //       }

    //       return
    //     } finally {
    //       // Clean up the blob URL
    //       URL.revokeObjectURL(blobUrl)
    //     }
    //   } catch (fetchError) {
    //     this.logger.warn('Failed to fetch worklet file, falling back to MediaRecorder:', fetchError)
    //     return this.setupMediaRecorder()
    //   }
    // } catch (error) {
    //   this.logger.error('Failed to load audio worklet', error)
    //   return this.setupMediaRecorder()
    // }
  }

  private async setupAudioProcessing(): Promise<void> {
    this.logger.debug('setupAudioProcessing called, useMediaRecorder:', this.useMediaRecorder)
    if (!this.audioContext || !this.mediaStream) {
      throw new Error('AudioContext or MediaStream not initialized')
    }

    if (this.useMediaRecorder) {
      this.logger.debug('Using MediaRecorder fallback branch')
      if (!this.mediaRecorderFallback) {
        this.mediaRecorderFallback = new MediaRecorderFallback(
          this.MIME_TYPE,
          (data: ArrayBuffer) => this.handleAudioData(data)
        )
        this.mediaRecorderFallback.initialize(this.mediaStream)
      }
      this.mediaRecorderFallback.start()
    } else {
      this.logger.debug('Using AudioWorklet for audio processing')
      // Use AudioWorklet (preferred, but may not work on HTTP)

      const source = this.audioContext.createMediaStreamSource(this.mediaStream)

      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-recording-processor', {
        processorOptions: {
          sampleRate: this.config.sampleRate,
          channels: this.config.channels,
          bitDepth: this.config.bitDepth,
        },
      })

      source.connect(this.workletNode)

      this.workletNode.port.onmessage = (event) => {
        const { type, data } = event.data

        if (type === AudioRecorderEvents.AudioData) {
          this.handleAudioData(data)
        }
      }
    }
  }

  private async handleAudioData(audioData: ArrayBuffer): Promise<void> {
    let bytes = new Uint8Array(audioData)
    let firstNonZero = bytes.findIndex((b) => b !== 0)

    // If all bytes are zero, skip
    if (firstNonZero === -1) {
      this.logger.warn('Skipping all-zero audio packet')
      return
    }

    // Trim leading zeros
    if (firstNonZero > 0) {
      this.logger.debug(`Trimming ${firstNonZero} leading zero bytes from audio packet`)
      bytes = bytes.slice(firstNonZero)
      audioData = bytes.buffer
    }

    const firstBytes = Array.from(bytes.slice(0, 8))
    this.logger.debug(
      `Audio chunk: size=${audioData.byteLength}, first bytes=${firstBytes.join(',')}`
    )

    if (this.bufferingMode) {
      this.logger.debug(`Buffered audio chunk, buffer size: ${this.audioBuffer.length + 1}`)
      this.audioBuffer.push(audioData)
    } else {
      await this.emit(AudioRecorderEvents.AudioData, audioData)
    }
  }

  private async cleanup(): Promise<void> {
    // Disconnect audio worklet
    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }

    // Stop media recorder
    if (this.mediaRecorder) {
      this.mediaRecorder.stop()
      this.mediaRecorder = null
    }

    // Stop media recorder fallback
    if (this.mediaRecorderFallback) {
      this.mediaRecorderFallback.stop()
    }
  }

  // Pre-initialize AudioContext and worklet for next session
  private async preInitialize(): Promise<void> {
    try {
      await this.setupAudioContext()
      await this.loadAudioWorklet()
      this.logger.debug('Pre-initialization complete')
    } catch (error) {
      this.logger.error('Pre-initialization failed', error)
      // Optionally: retry or handle error
    }
  }

  public isInitialized(): boolean {
    return this.mediaStream !== null
  }

  dispose(): void {
    if (this.recording) {
      this.stop()
    }
  }
}
