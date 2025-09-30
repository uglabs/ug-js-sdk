export interface IVADManager {
  initialize(stream: MediaStream): Promise<void>
  startAnalysis(): void
  stopAnalysis(): void
  on(event: 'voiceActivity' | 'silence', callback: (data?: VADVoiceActivityEvent) => void): void
  startSilenceTimer(): void
  clearSilenceTimer(): void
}

export const UserInputManagerEvents = {
  UserInput: 'user-input',
  UserSpeaking: 'user-speaking',
  UserSilence: 'user-silence',
} as const

export const AUDIO_RECORDER_EVENTS = {
  RecordingStarted: 'recording-started',
  RecordingStopped: 'recording-stopped',
  AudioData: 'audio-data',
  Error: 'error',
} as const

export type AudioRecorderEventType =
  (typeof AUDIO_RECORDER_EVENTS)[keyof typeof AUDIO_RECORDER_EVENTS]

export interface IAudioRecorder {
  initialize(stream?: MediaStream): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  isRecording(): boolean
  enableBufferingMode(): void
  disableBufferingMode(): void
  getBufferedAudio(): ArrayBuffer[]
  clearBuffer(): void
  on(event: AudioRecorderEventType, callback: Function): void
}

export interface VADVoiceActivityEvent {
  isSpeaking: boolean
  confidence: number
  misfire?: boolean
}

export const VadManagerEvents = {
  VoiceActivity: 'voiceActivity',
  Silence: 'silence',
} as const
