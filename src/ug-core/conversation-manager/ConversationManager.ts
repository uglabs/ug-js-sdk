import { DefaultLogger, StylePurple } from '../core/Logger'
import { EventEmitter } from '../core/EventEmitter'
import { ConversationNetworkEvents, INetwork } from '../network/types'
import { PlaybackManagerEvents } from '../playback-manager/PlaybackManager'
import {
  ImageChangeEvent,
  SubtitleChangeEvent,
  WordHighlightEvent,
} from '../playback-manager/types'
import { IVADManager } from '../user-input-manager'
import { VADManager } from '../user-input-manager/VADManager'
import {
  ConversationError,
  ConversationState,
  InputEnvelope,
  ConversationConfig,
  InteractRequest,
} from '../types'
import { UserInputManagerEvents } from '../user-input-manager/types'
import { ConversationNetwork } from '../network/ConversationNetwork'
import { PlaybackManager } from '../playback-manager/PlaybackManager'
import { UserInputManager } from '../user-input-manager/UserInputManager'
import { IConversationManager } from './types'

export const ConversationManagerEvents = {
  StateChange: 'stateChange',
} as const

export class ConversationManager extends EventEmitter implements IConversationManager {
  private state: ConversationState = 'idle'
  private network: ConversationNetwork
  private vadManager: IVADManager
  private userInputManager: UserInputManager
  private playbackManager: PlaybackManager
  private config: ConversationConfig
  private interactionCompletePending = false
  private mediaStream: MediaStream | null = null
  private isTextOnly = false

  constructor(config: ConversationConfig) {
    const logger = new DefaultLogger({ category: '🧞 ConversationManager', style: StylePurple })
    super(logger)
    this.config = {
      ...config,
      capabilities: config.capabilities || {
        audio: true,
        viseme: true, // Unused
        subtitles: true,
        avatar: true,
      },
      inputCapabilities: config.inputCapabilities || {
        audio: true,
        text: true,
      },
    }
    // Clone and mask sensitive fields before logging
    const loggedConfig = {
      ...config,
      ...(config.apiKey && { apiKey: config.apiKey.slice(0, 4) + '...' }),
      ...(config.federatedId && { federatedId: config.federatedId.slice(0, 4) + '...' }),
    }
    logger.info('Initializing with config', loggedConfig)
    // Dependency injection
    this.network = new ConversationNetwork(config)
    this.vadManager = new VADManager()
    this.userInputManager = new UserInputManager(
      this.config.inputCapabilities!,
      this.vadManager,
      this.network,
      config.recordingConfig
    )
    this.playbackManager = new PlaybackManager(this.config.capabilities!)
    this.playbackManager.wireVADToAvatar(this)
    this.playbackManager.wireConversationStateToAvatar(this)
    this.setupEventListeners()
    this.setState('uninitialized')
  }

  async initialize(): Promise<void> {
    try {
      this.logger.debug('Initializing...')
      this.setState('initializing')
      await this.network.initialize()
      this.playbackManager.initialize()

      if (this.config.inputCapabilities?.audio && !this.mediaStream) {
        const recordingConfig = this.config.recordingConfig
        const constraints: MediaTrackConstraints = {
          echoCancellation: recordingConfig?.echoCancellation,
          noiseSuppression: recordingConfig?.noiseSuppression,
          autoGainControl: recordingConfig?.autoGainControl,
          sampleRate: recordingConfig?.sampleRate,
          channelCount: recordingConfig?.channels,
        }
        Object.keys(constraints).forEach(
          (key) =>
            constraints[key as keyof MediaTrackConstraints] === undefined &&
            delete constraints[key as keyof MediaTrackConstraints]
        )
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      }

      await this.userInputManager.initialize(this.mediaStream ?? undefined)
      await this.network.connect()
      this.logger.debug('Initialized successfully')
      this.setState('waiting')
    } catch (error) {
      this.handleError('server_error', error as Error)
    }
  }

  async startListening(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start listening from state: ${this.state}`)
    }

    try {
      await this.userInputManager.start()
      this.setState('listening')
    } catch (error) {
      this.handleError('mic_denied', error as Error)
    }
  }

  async stopListening(): Promise<void> {
    this.logger.debug('stopListening called from state:', this.state)
    const isStopped = await this.userInputManager.stop()
    if (!isStopped) {
      this.setState('waiting')
    }
  }

  async interact(request: InteractRequest): Promise<void> {
    if (!this.network.isReady()) {
      const errorMessage = 'Network is not ready, cannot send text. probably disconnected'
      this.logger.error(errorMessage)
      this.handleError('network_timeout', new Error(errorMessage))
    }
    if (this.state === 'idle' || this.state === 'listening') {
      try {
        await this.setState('waiting')
        await this.userInputManager.interact(request)
      } catch (error) {
        this.logger.error('Error sending text message', error)
        this.handleError('network_timeout', error as Error)
      }
    }
  }

  async interrupt(): Promise<void> {
    this.playbackManager.pause()
    await this.setState('interrupted')
  }

  async pause(): Promise<void> {
    if (this.state !== 'playing') {
      this.logger.warn(`Cannot pause from state: ${this.state}`)
      return
    }
    this.playbackManager.pause()
    await this.setState('paused')
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') {
      this.logger.warn(`Cannot resume from state: ${this.state}`)
      return
    }
    // @ts-ignore - resume is not yet defined on PlaybackManager
    this.playbackManager.resume()
    await this.setState('playing')
  }

  async forceInputComplete(): Promise<void> {
    if (this.state === 'userSpeaking' || this.state === 'listening') {
      await this.userInputManager.sendInputComplete()
    } else {
      this.logger.warn(`Cannot force input complete from state: ${this.state}`)
    }
  }

  async stop(): Promise<void> {
    await this.userInputManager.stop()
    this.playbackManager.pause()
    await this.network.disconnect()
    await this.setState('idle')
  }

  private async setState(newState: ConversationState): Promise<void> {
    if (this.state === newState) {
      return
    }
    const oldState = this.state
    this.state = newState
    this.config.hooks.onStateChange?.(newState)
    await this.emit(ConversationManagerEvents.StateChange, { oldState, newState })
    this.logger.debug(`State transition: ${oldState} -> ${newState}`)
  }

  private setupEventListeners(): void {
    this.userInputManager.on(UserInputManagerEvents.UserInput, async (envelope: InputEnvelope) => {
      await this.network.send(envelope)
      if (envelope.type === 'input_complete') {
        await this.setState('waiting')
      }
    })

    this.playbackManager.on(
      PlaybackManagerEvents.SubtitleWordChange,
      (event: WordHighlightEvent) => {
        this.config.hooks.onSubtitleHighlight?.(event)
      }
    )
    this.playbackManager.on(PlaybackManagerEvents.SubtitleChange, (event: SubtitleChangeEvent) => {
      this.config.hooks.onSubtitleChange?.(event)
    })

    this.playbackManager.on(PlaybackManagerEvents.ImageChange, (event: ImageChangeEvent) => {
      this.config.hooks.onImageChange?.(event)
    })

    this.playbackManager.on(PlaybackManagerEvents.AvatarAnimationChanged, (payload: any) => {
      this.config.hooks.onAvatarAnimationChanged?.(payload)
    })

    this.userInputManager.on(UserInputManagerEvents.UserSpeaking, async () => {
      await this.setState('userSpeaking')
    })

    this.userInputManager.on(UserInputManagerEvents.UserSilence, async () => {
      await this.setState('listening')
    })

    this.network.on(ConversationNetworkEvents.Connected, async () => {
      this.config.hooks.onNetworkStatusChange?.(true)
    })

    this.network.on(ConversationNetworkEvents.Disconnected, async () => {
      this.config.hooks.onNetworkStatusChange?.(false)
    })

    this.network.on(ConversationNetworkEvents.Message, async (message: any) => {
      if (message.kind === 'interact' && message.event === 'text') {
        this.config.hooks.onTextMessage?.(message)
      }
      if (message.event === 'data') {
        this.config.hooks.onDataMessage?.(message)
      }
      if (message.kind === 'check_turn' && message.is_user_still_speaking === false) {
        this.logger.debug(`check_turn handler: state is ${this.state}`)
        if (this.state === 'playing' || this.state === 'paused') {
          this.logger.debug('check_turn received while playing / paused, ignoring.')
          return
        }
        await this.network.interactAudio()
        await this.stopListening()
      }

      // Handle interaction_complete event
      if (message.kind === 'interact' && message.event === 'interaction_complete') {
        if (this.state === 'playing' || this.state === 'paused') {
          this.logger.debug('Interaction complete received while playing / paused, deferring.')
          this.interactionCompletePending = true
        } else {
          await this.handleInteractionComplete()
        }
      }
      if (message.type === 'interaction_error') {
        this.handleError(
          'server_error',
          new Error(message.error || 'Unknown server interaction error')
        )
      }
      if (message.type === 'string') {
        this.config.hooks.onStringMessage?.(message)
      }
      this.playbackManager.handleMessage(message)
    })

    this.network.on(ConversationNetworkEvents.Error, async (error: Error) => {
      this.handleError('network_error', error)
    })

    this.playbackManager.on(PlaybackManagerEvents.PlaybackError, async (error: any) => {
      this.handleError('decode_error', error)
    })

    // Set state to 'playing' when audio playback starts
    this.playbackManager.on(PlaybackManagerEvents.Playing, async () => {
      await this.setState('playing')
    })

    this.playbackManager.on(PlaybackManagerEvents.Finished, async () => {
      // only if the last state was set by playback manager such as
      //playing - so to prevent change to userTalking state and other states
      if (this.state === 'playing') {
        this.userInputManager.reset()
        await this.setState('idle')
      }
      if (this.interactionCompletePending) {
        this.logger.debug('Playback finished, processing deferred interaction complete.')
        this.interactionCompletePending = false
        await this.handleInteractionComplete()
      }
    })

    // Handle about-to-complete event from playback manager
    this.playbackManager.on(PlaybackManagerEvents.AboutToComplete, () => {
      if (this.state !== 'playing') {
        this.logger.debug('AboutToComplete received but not in playing state, ignoring.')
        return
      }
      this.logger.debug('Audio about to complete, starting recording in buffering mode')
      this.userInputManager.enableAudioBuffering()
      // Start user input manager without awaiting to prevent blocking the main thread,
      // which could interfere with the final audio playback.
      this.userInputManager.start().catch((error: Error) => {
        this.logger.error('Failed to start recording on about-to-complete', error)
      })
    })
  }

  private async handleError(type: ConversationError['type'], error: Error): Promise<void> {
    const conversationError: ConversationError = {
      type,
      message: error.message,
      originalError: error,
    }

    await this.setState('error')
    this.config.hooks.onError?.(conversationError)
    this.logger.error(`Conversation error: ${type}`, error)
  }

  private async handleInteractionComplete(): Promise<void> {
    this.logger.debug('Interaction complete received, not starting new interaction')
    // Reset AboutToComplete logic immediately to prevent late events
    this.playbackManager.resetAboutToComplete()

    try {
      this.userInputManager.reset()
      this.userInputManager.flushBufferedAudio()
      await this.setState('idle')
    } catch (error) {
      this.logger.error('Failed to handle interaction complete', error)
      this.handleError('network_timeout', error as Error)
    }
  }

  public async toggleTextOnlyInput(isTextOnly: boolean): Promise<void> {
    this.isTextOnly = isTextOnly
    await this.updateInputCapabilities()
  }

  private async updateInputCapabilities(): Promise<void> {
    this.logger.debug(`Updating input capabilities, textOnly: ${this.isTextOnly}`)
    this.config.inputCapabilities = {
      ...this.config.inputCapabilities,
      audio: !this.isTextOnly,
      text: this.isTextOnly,
    }
    await this.userInputManager.updateCapabilities(this.config.inputCapabilities)
    if (this.isTextOnly) {
      await this.userInputManager.stopRecording()
    } else {
      if (this.state === 'idle') {
        await this.startListening()
      }
    }
  }
}
