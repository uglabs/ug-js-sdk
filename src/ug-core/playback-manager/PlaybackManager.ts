import { EventEmitter } from '@/ug-core/core/EventEmitter'
import { AudioEvent, InteractResponse, PlaybackCapabilities } from '@/ug-core/types'
import { DefaultLogger, StyleOrange } from '@/ug-core/core/Logger'
import { ConversationManagerEvents } from '@/ug-core/conversation-manager/ConversationManager'

import { AudioPlayer } from './audio-player/AudioPlayer'
import { SubtitleManager, SubtitleManagerEvents } from './subtitle-manager/SubtitleManager'
import { AudioPlayerEvents, IAudioPlayer, IAvatar, SubtitleChangeEvent } from './types'
import { VisemeScheduler } from './viseme-scheduler/VisemeScheduler'
import { AvatarManager } from './avatar-manager/AvatarManager'
import { IConversationManager } from '../conversation-manager/types'

export const PlaybackManagerEvents = {
  Playing: 'playing',
  Paused: 'paused',
  PlaybackError: 'playbackError',
  SubtitleWordChange: 'subtitleWordChange',
  SubtitleChange: 'subtitleChange',
  ImageChange: 'imageChange',
  AboutToComplete: 'aboutToComplete',
  Finished: 'finished',
  AvatarAnimationChanged: 'avatarAnimationChanged',
} as const

export class PlaybackManager extends EventEmitter {
  private audioPlayer: IAudioPlayer
  private visemeScheduler: VisemeScheduler
  private subtitleManager: SubtitleManager
  private isPaused: boolean = true
  private hasStarted: boolean = false
  private avatarManager: IAvatar

  constructor(private capabilities: PlaybackCapabilities) {
    const logger = new DefaultLogger({ category: '🎪 PlaybackManager', style: StyleOrange })
    super(logger)

    this.audioPlayer = new AudioPlayer()
    this.visemeScheduler = new VisemeScheduler(new AudioContext())
    this.subtitleManager = new SubtitleManager(() => this.audioPlayer.getCurrentTime())
    this.avatarManager = new AvatarManager()
    this.avatarManager.on('animation-changed', async (payload: any) => {
      await this.emit(PlaybackManagerEvents.AvatarAnimationChanged, payload)
    })

    this.setupChildListeners()

    this.resetState()
  }

  private setupChildListeners(): void {
    // When audio has enough frames ready - we play
    this.audioPlayer.on(AudioPlayerEvents.Ready, () => {
      if (this.isPaused && !this.hasStarted) {
        this.logger.debug('Ready event received, starting playback')
        this.play()
      } else {
        this.logger.debug('Ready event received but already playing or paused, ignoring')
      }
    })
    this.audioPlayer.on(AudioPlayerEvents.AboutToComplete, async () => {
      this.logger.debug('Audio about to complete')
      await this.emit(PlaybackManagerEvents.AboutToComplete)
    })
    this.audioPlayer.on(AudioPlayerEvents.Error, async (error: any) => {
      await this.emit(PlaybackManagerEvents.PlaybackError, { source: 'audio', error })
    })
    this.audioPlayer.on(AudioPlayerEvents.Finished, async () => {
      await this.emit(PlaybackManagerEvents.Finished)
      this.reset()
    })
    this.subtitleManager.on(SubtitleManagerEvents.WordChange, async (event: any) => {
      await this.emit(PlaybackManagerEvents.SubtitleWordChange, event)
    })
    this.subtitleManager.on(
      SubtitleManagerEvents.SubtitleChange,
      async (event: SubtitleChangeEvent) => {
        await this.emit(PlaybackManagerEvents.SubtitleChange, event)
      }
    )
  }

  resetState(): void {
    this.isPaused = true
    this.hasStarted = false
  }

  initialize(): void {
    this.logger.debug('Initialized', this.capabilities)
    this.isPaused = true
    this.hasStarted = false
    this.audioPlayer.initialize()
  }

  handleMessage(message: InteractResponse) {
    if (message.event === 'audio' || message.event === 'subtitles' || message.event === 'viseme') {
      this.enqueue(message)
    } else if (message.event === 'audio_complete') {
      this.markAudioComplete()
    } else if (message.event === 'image') {
      this.emit(PlaybackManagerEvents.ImageChange, message)
    }
  }

  enqueue(message: InteractResponse): void {
    if (this.capabilities.audio && message.event === 'audio') {
      const audioMessage = message as AudioEvent
      this.audioPlayer.enqueue(audioMessage.audio)
    }

    // if (this.capabilities.subtitles && message.event === 'subtitles') {
    //   const subtitleMessage = message as SubtitleMessage
    //   this.subtitleManager.enqueue(subtitleMessage)
    // }
  }

  markAudioComplete(): void {
    this.logger.debug('Marking audio as complete')
    if (this.capabilities.audio) {
      this.audioPlayer.markComplete()
    }
  }

  async play(): Promise<void> {
    this.isPaused = false
    this.hasStarted = true

    this.avatarManager.playTalk()

    await Promise.all([
      this.capabilities.viseme ? this.visemeScheduler.play() : Promise.resolve(),
      this.capabilities.subtitles ? this.subtitleManager.play() : Promise.resolve(),
      this.capabilities.audio ? this.audioPlayer.play() : Promise.resolve(),
    ])

    await this.emit(PlaybackManagerEvents.Playing)
  }

  async pause(): Promise<void> {
    this.isPaused = true
    this.audioPlayer.pause()
    this.visemeScheduler.pause()
    this.subtitleManager.pause()
    this.avatarManager.playIdle()
    await this.emit(PlaybackManagerEvents.Paused)
  }

  async resume(): Promise<void> {
    if (!this.isPaused) return
    this.isPaused = false

    this.avatarManager.playTalk()

    await Promise.all([
      this.capabilities.viseme ? this.visemeScheduler.play() : Promise.resolve(),
      this.capabilities.subtitles ? this.subtitleManager.play() : Promise.resolve(),
      this.capabilities.audio ? this.audioPlayer.resume() : Promise.resolve(),
    ])

    await this.emit(PlaybackManagerEvents.Playing)
  }

  // Needed for safari unlock play button
  public async resumeAudioContext(): Promise<void> {
    if (typeof (this.audioPlayer as any).resumeAudioContext === 'function') {
      await (this.audioPlayer as any).resumeAudioContext()
    }
  }

  public reset(): void {
    this.resetState()
    this.audioPlayer?.reset()
    this.subtitleManager?.reset()
    this.avatarManager.playIdle()
  }

  public resetAboutToComplete(): void {
    this.audioPlayer?.resetAboutToComplete()
  }

  /**
   * Call this after constructing PlaybackManager to wire up VAD events to avatar animation.
   * @param vadManager The VADManager instance to listen to.
   */
  public wireVADToAvatar(conversationManager: IConversationManager) {
    conversationManager.on(
      ConversationManagerEvents.StateChange,
      (event: { oldState: string; newState: string }) => {
        if (event.newState === 'userSpeaking') {
          this.avatarManager.playListen()
        } else if (event.newState === 'listening') {
          this.avatarManager.playIdle()
        }
      }
    )
  }

  /**
   * Wire up conversation state changes to avatar animations.
   * @param conversationManager The ConversationManager instance to listen to.
   */
  public wireConversationStateToAvatar(conversationManager: IConversationManager) {
    conversationManager.on(
      ConversationManagerEvents.StateChange,
      (event: { oldState: string; newState: string }) => {
        if (event.newState === 'waiting') {
          this.avatarManager.playThink()
        }
      }
    )
  }
}
