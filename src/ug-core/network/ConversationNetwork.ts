import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from '../core/EventEmitter'
import { DefaultLogger, StyleGrey } from '../core/Logger'
import { WebSocketConnection } from './WebSocketConnection'
import { ConversationNetworkEvents, INetwork, NetworkEventHandlers } from './types'
import {
  AddAudioRequest,
  AddAudioResponse,
  AudioConfig,
  AudioInputEnvelope,
  AuthenticateRequest,
  AuthenticateResponse,
  Base64,
  CheckTurnRequest,
  CheckTurnResponse,
  ConversationConfig,
  ErrorResponse,
  InteractRequest,
  Request,
  Response,
  SetConfigurationRequest,
  SetConfigurationResponse,
} from '../types'

import API from './api'

const audioConfig: AudioConfig = {
  sampling_rate: 48000,
  mime_type: 'audio/mpeg',
}

export class ConversationNetwork extends EventEmitter<any> implements INetwork {
  private wsConnection: WebSocketConnection | null = null
  private _api: API | null = null
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void
      reject: (reason?: any) => void
      timeout: NodeJS.Timeout
      isStream: boolean
    }
  >()

  constructor(private config: ConversationConfig) {
    const logger = new DefaultLogger({ category: '🗣️ConversationNetwork', style: StyleGrey })
    super(logger)
    this._api = new API({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      federatedId: config.federatedId,
    })
  }

  async initialize() {
    try {
      await this._api.login()
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || 'Authentication failed'
      const traceback = error.response?.data?.traceback
      if (traceback) {
        this.logger.error('Authentication failed:', errorMessage, '\nTraceback:', traceback)
      } else {
        this.logger.error('Authentication failed:', errorMessage)
      }
      const err = new Error(errorMessage)
      if (traceback) {
        // @ts-ignore
        err.traceback = traceback
      }
      throw err
    }
  }

  async connect(): Promise<void> {
    // Cleanly remove the trailing '/api' (with or without slash) and add '/interact'
    let wsUrl = this.config.apiUrl.replace(/\/api\/?$/, '') + '/interact'
    this.wsConnection = new WebSocketConnection(wsUrl, this.getWebSocketHandlers())
    this.wsConnection.connect()

    // Wait for WebSocket to be ready with 10 second timeout
    await this.waitForWebSocketReady(10000)

    this.logger.debug('Network connections established - Authenticating next...')
  }

  private async waitForWebSocketReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wsConnection) {
        reject(new Error('WebSocket connection not initialized'))
        return
      }

      // Check if already ready
      if (this.wsConnection.isReady()) {
        resolve()
        return
      }

      const timeout = setTimeout(() => {
        reject(new Error(`WebSocket connection timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      // Poll for readiness
      const checkReady = () => {
        if (this.wsConnection?.isReady()) {
          clearTimeout(timeout)
          resolve()
        } else {
          setTimeout(checkReady, 50) // Check every 50ms
        }
      }

      checkReady()
    })
  }

  private getWebSocketHandlers(): NetworkEventHandlers {
    return {
      onOpen: async () => {
        await this.authenticate()
        await this.setConfiguration()
        this.emit(ConversationNetworkEvents.Connected)
        // Initiate a simple . to the engine to get back a response
        await this.interact({ text: '.', uid: '', kind: 'interact', type: 'stream' })
      },
      onMessage: async (message: any) => {
        if (message.uid && this.pendingRequests.has(message.uid)) {
          const promise = this.pendingRequests.get(message.uid)
          if (promise) {
            if (promise.isStream) {
              if (message.kind === 'close') {
                clearTimeout(promise.timeout)
                promise.resolve(message) // Resolve the initial promise
                this.pendingRequests.delete(message.uid)
              } else if (message.kind === 'error') {
                this.logger.error(message.error)
                this.emit(ConversationNetworkEvents.Error, new Error(message.error))
              } else {
                this.emit(ConversationNetworkEvents.Message, message)
              }
            } else {
              clearTimeout(promise.timeout)
              if (message.kind === 'error') {
                const errorMessage = message as ErrorResponse
                this.logger.error(errorMessage?.error)
                promise.reject(errorMessage.error)
              } else {
                promise.resolve(message)
              }
              this.pendingRequests.delete(message.uid)
              this.emit(ConversationNetworkEvents.Message, message)
            }
          }
        } else if (message.kind === 'interact') {
          this.emit(ConversationNetworkEvents.Message, message)
        } else if (message.kind === 'error') {
          this.logger.error(message.error)
          await this.emit(ConversationNetworkEvents.Error, message.error)
        } else {
          this.logger.warn('Received message without a matching request UID', message)
        }
      },
      onError: async (error) => {
        await this.emit(ConversationNetworkEvents.Error, error)
      },
      onClose: async () => {
        await this.emit(ConversationNetworkEvents.Disconnected)
      },
    }
  }

  private async makeRequest<T extends Response>(request: Request, timeoutMs = 50000): Promise<T> {
    return this.makeRequestInternal(request, timeoutMs, false)
  }

  // Notice that awaiting here means await till the response is back from the server
  // As in Request->Response->Promise fulfilled
  private async makeStreamRequest<T extends Response>(
    request: Request,
    timeoutMs = 50000
  ): Promise<T> {
    return this.makeRequestInternal(request, timeoutMs, true)
  }

  private async makeRequestInternal<T extends Response>(
    request: Request,
    timeoutMs: number,
    isStream: boolean
  ): Promise<T> {
    if (!this.wsConnection?.isReady()) {
      throw new Error('WebSocket not ready')
    }
    request.uid = uuidv4()
    request.client_start_time = new Date().toISOString()

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.uid)
        reject(new Error(`Request ${request.uid} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pendingRequests.set(request.uid, { resolve, reject, timeout, isStream })
    })

    this.wsConnection.send(request)
    return promise
  }

  async authenticate(): Promise<void> {
    const request: AuthenticateRequest = {
      type: 'request',
      kind: 'authenticate',
      access_token: this._api.authToken,
      uid: '', // will be set by makeRequest
    }
    await this.makeRequest<AuthenticateResponse>(request)
  }

  async setConfiguration(): Promise<void> {
    const request: SetConfigurationRequest = {
      type: 'request',
      kind: 'set_configuration',
      config: {
        prompt: this.config.prompt,
        voice_profile: this.config.voiceProfile,
        utilities: this.config.utilities,
      },
      uid: '', // will be set by makeRequest
    }
    await this.makeRequest<SetConfigurationResponse>(request)
  }

  async addAudio(audio: Base64): Promise<void> {
    const request: AddAudioRequest = {
      type: 'request',
      kind: 'add_audio',
      audio,
      uid: '', // will be set by makeRequest
      config: audioConfig,
    }
    await this.makeRequest<AddAudioResponse>(request)
  }

  async checkTurn(): Promise<void> {
    const request: CheckTurnRequest = {
      type: 'request',
      kind: 'check_turn',
      uid: '', // will be set by makeRequest
    }
    await this.makeRequest<CheckTurnResponse>(request)
  }

  async interact(request: InteractRequest): Promise<void> {
    request.context = { ...this.config.context, ...request.context }
    request.audio_output = this.config.capabilities?.audio ?? true
    request.kind = request.kind ?? 'interact'
    request.type = request.type ?? 'stream'
    this.makeStreamRequest<Response>(request)
  }

  /**
   * Process the audio that was sent till now
   */
  async interactAudio(): Promise<void> {
    const request: InteractRequest = {
      type: 'stream',
      kind: 'interact',
      context: { ...this.config.context },
      audio_output: this.config.capabilities?.audio ?? true,
      uid: '', // will be set by makeStreamRequest
    }
    this.makeStreamRequest<Response>(request)
  }

  async disconnect(): Promise<void> {
    this.wsConnection?.disconnect()
  }

  isReady(): boolean {
    return this.wsConnection?.isReady() || false
  }

  async send(data: any): Promise<void> {
    if (data.type === 'audio') {
      await this.addAudio((data as AudioInputEnvelope).audio)
      return
    } else {
      this.logger.warn('ConversationNetwork.send is deprecated. Use specific methods instead.')
    }
  }
}
