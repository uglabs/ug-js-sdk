import {
  ImageChangeEvent,
  SubtitleChangeEvent,
  WordHighlightEvent,
} from '../playback-manager/types'
import { AudioRecordingConfig } from '../user-input-manager'

export interface ILogger {
  trace(message: string, ...args: any[]): void
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
}

export interface PlaybackCapabilities {
  audio?: boolean
  viseme?: boolean
  subtitles?: boolean
  avatar?: boolean
}

export interface InputCapabilities {
  audio?: boolean
  text?: boolean
}

/**
 * ElevenLabs-specific voice profile parameters.
 */
export interface VoiceProfile {
  /** The voice ID to use for synthesis, or undefined for default */
  voice_id?: string
  /** Speaking speed, range: 0.7 - 1.2 (undefined for default) */
  speed?: number
  /** Stability, range: 0.0 - 1.0 (undefined for default) */
  stability?: number
  /** Similarity boost, range: 0.0 - 1.0 (undefined for default) */
  similarity_boost?: number
}

export interface ConversationConfig {
  apiUrl: string
  apiKey: string
  federatedId: string
  imageFrame?: string
  personaId?: string
  prompt: string
  context?: Record<string, string | number | boolean>
  voiceProfile?: VoiceProfile
  hooks: {
    onTextMessage?: (event: TextEvent) => void
    onStringMessage?(message: StringMessage): unknown
    onStateChange?: (state: ConversationState) => void
    onSubtitleHighlight?: (event: WordHighlightEvent) => void
    onSubtitleChange?: (subtitle: SubtitleChangeEvent) => void
    onImageChange?: (event: ImageChangeEvent) => void
    onNetworkStatusChange?: (isReady: boolean) => void
    onError?: (error: ConversationError) => void
    onAvatarAnimationChanged?: (payload: { name: string; layer: number; loop: boolean }) => void
  }
  capabilities?: PlaybackCapabilities
  inputCapabilities?: InputCapabilities
  logger?: ILogger
  recordingConfig?: AudioRecordingConfig
}

export type ConversationState =
  | 'uninitialized'
  | 'initializing'
  | 'idle'
  | 'paused'
  | 'listening'
  | 'userSpeaking'
  | 'waiting'
  | 'playing'
  | 'completed'
  | 'interrupted'
  | 'error'

export interface ConversationError {
  type: 'mic_denied' | 'network_timeout' | 'network_error' | 'server_error' | 'decode_error'
  message: string
  originalError?: Error
}

export interface InputEnvelope {
  type: 'audio' | 'text' | 'input_complete'
  data?: any
  text?: any
}

export interface AudioInputEnvelope extends InputEnvelope {
  type: 'audio'
  audio: string //Base64 encoded audio chunk
}

export interface Message {
  type: string
}

export interface StringMessage extends Message {
  type: 'string'
  source_id?: string
  source_name?: string
  source_type?: string
  string: string //The actual value
}

export type Base64 = string

export interface AudioConfig {
  mime_type: string
  sampling_rate?: number
}

export interface Request {
  type: 'request' | 'stream'
  kind: string
  uid: string
  client_start_time?: string
  server_start_time?: string
}

export interface Response {
  kind: string
  uid: string
  client_start_time?: string
  server_start_time?: string
  server_end_time?: string
}

export interface ErrorResponse extends Response {
  kind: 'error'
  error: string
}

export interface AuthenticateRequest extends Request {
  kind: 'authenticate'
  access_token: string
}

export interface AuthenticateResponse extends Response {
  kind: 'authenticate'
}

export interface PingRequest extends Request {
  kind: 'ping'
}

export interface PingResponse extends Response {
  kind: 'ping'
}

export interface SetServiceProfileRequest extends Request {
  kind: 'set_service_profile'
  service_profile: string
}

export interface SetServiceProfileResponse extends Response {
  kind: 'set_service_profile'
}

export interface AddAudioRequest extends Request {
  kind: 'add_audio'
  audio: Base64
  config: AudioConfig
}

export interface AddAudioResponse extends Response {
  kind: 'add_audio'
}

export interface ClearAudioRequest extends Request {
  kind: 'clear_audio'
}

export interface ClearAudioResponse extends Response {
  kind: 'clear_audio'
}

export interface CheckTurnRequest extends Request {
  kind: 'check_turn'
}

export interface CheckTurnResponse extends Response {
  kind: 'check_turn'
  is_user_still_speaking: boolean
}

export interface TranscribeRequest extends Request {
  kind: 'transcribe'
  language_code?: string
}

export interface TranscribeResponse extends Response {
  kind: 'transcribe'
  text: string
}

export interface AddKeywordsRequest extends Request {
  kind: 'add_keywords'
  keywords: string[]
}

export interface AddKeywordsResponse extends Response {
  kind: 'add_keywords'
}

export interface RemoveKeywordsRequest extends Request {
  kind: 'remove_keywords'
  keywords: string[]
}

export interface RemoveKeywordsResponse extends Response {
  kind: 'remove_keywords'
}

export interface DetectKeywordsRequest extends Request {
  kind: 'detect_keywords'
}

export interface DetectKeywordsResponse extends Response {
  kind: 'detect_keywords'
  keywords: string[]
}

export interface AddSpeakerRequest extends Request {
  kind: 'add_speaker'
  speaker: string
  audio: Base64
}

export interface AddSpeakersResponse extends Response {
  kind: 'add_speaker'
}

export interface RemoveSpeakersRequest extends Request {
  kind: 'remove_speakers'
  speakers: string[]
}

export interface RemoveSpeakersResponse extends Response {
  kind: 'remove_speakers'
}

export interface DetectSpeakersRequest extends Request {
  kind: 'detect_speakers'
}

export interface DetectSpeakersResponse extends Response {
  kind: 'detect_speakers'
  speakers: string[]
}

export interface Configuration {
  prompt?: string | Reference
  temperature?: number
  utilities?: Record<string, any | Reference | null>
  voice_profile?: VoiceProfile
}

export interface Reference {
  reference: string
}

export interface SetConfigurationRequest extends Request {
  kind: 'set_configuration'
  config: Configuration
}

export interface SetConfigurationResponse extends Response {
  kind: 'set_configuration'
}

export interface MergeConfigurationRequest extends Request {
  kind: 'merge_configuration'
  references?: Reference[]
}

export interface MergeConfigurationResponse extends Response {
  kind: 'merge_configuration'
  utilities: string[]
}

export interface GetConfigurationRequest extends Request {
  kind: 'get_configuration'
}

export interface GetConfigurationResponse extends Response {
  kind: 'get_configuration'
  config: Configuration
}

export interface RenderPromptRequest extends Request {
  kind: 'render_prompt'
  context?: Record<string, any>
}

export interface RenderPromptResponse extends Response {
  kind: 'render_prompt'
  prompt: string
}

export interface InteractRequest extends Request {
  kind: 'interact'
  text?: string
  speakers?: string[]
  context?: Record<string, any>
  /*
   * A list of utility names that should be called when user input is available.
   * Unlike the `on_input` utilities, these are *non-blocking* and their outputs
   * will not be available in the context for the prompt.
   */ 
  on_input_non_blocking?: string[]
  /*
   * A list of utility names that should be called when user input is available.
   * Evaluation of these utilities happens before the prompt is rendered, so that
   * their values can be used in the prompt.
   * Note: Use with caution, as this delays the assistant output and everything
   * that follows (audio output, output utilities, etc.).
   */
  on_input?: string[]
  /*
   * A list of utility names that should be called when assistant output is
   * available.
   */
  on_output?: string[]
  audio_output?: boolean
  language_code?: string
}

export interface InteractResponse extends Response {
  kind: 'interact'
  event: string
}

export interface InteractionStartedEvent extends InteractResponse {
  event: 'interaction_started'
}

export interface TextEvent extends InteractResponse {
  event: 'text'
  text: string
}

export interface TextCompleteEvent extends InteractResponse {
  event: 'text_complete'
}

export interface AudioEvent extends InteractResponse {
  event: 'audio'
  audio: Base64
}

export interface AudioCompleteEvent extends InteractResponse {
  event: 'audio_complete'
}

export interface DataEvent extends InteractResponse {
  event: 'data'
  data: Record<string, any>
}

export interface InteractionErrorEvent extends InteractResponse {
  event: 'interaction_error'
  error: string
}

export interface InteractionCompleteEvent extends InteractResponse {
  event: 'interaction_complete'
}

export interface InterruptRequest extends Request {
  kind: 'interrupt'
  target_uid: string
  at_character?: number
}

export interface InterruptResponse extends Response {
  kind: 'interrupt'
}

export interface RunRequest extends Request {
  kind: 'run'
  utilities?: string[]
  context?: Record<string, any>
  bindings?: Record<string, string>
}

export interface RunResponse extends Response {
  kind: 'run'
}


export interface Utility {
  type: string
}


export interface Classify extends Utility {
    type: "classify"
    // The questions is a template like the interaction prompt, and has access to
    // the context relevant to the stage when it's evaluated.
    classification_question: string
    additional_context?: string
    answers: string[]
}