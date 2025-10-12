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

  constructor(
    private apiUrl: string,
    private apiKey: string,
    private federatedId: string,
    private prompt: string,
    private contextValues?: Record<string, string | number | boolean>
  ) {
    const logger = new DefaultLogger({ category: '🗣️ConversationNetwork', style: StyleGrey })
    super(logger)
    this._api = new API({ apiUrl, apiKey, federatedId })
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
    let wsUrl = this.apiUrl.replace(/\/api\/?$/, '') + '/interact'
    this.wsConnection = new WebSocketConnection(wsUrl, this.getWebSocketHandlers())
    this.wsConnection.connect()
    this.logger.debug('Network connections established - Authenticating next...')
  }

  private getWebSocketHandlers(): NetworkEventHandlers {
    return {
      onOpen: async () => {
        await this.authenticate()
        await this.setConfiguration()
        this.emit(ConversationNetworkEvents.Connected)
        await this.interact('.')
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
      config: { prompt: this.prompt },
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

  async interact(
    text: string | undefined = undefined,
    context: Record<string, any> = {}
  ): Promise<void> {
    const request: InteractRequest = {
      type: 'stream',
      kind: 'interact',
      text,
      context: { ...this.contextValues, ...context },
      audio_output: true,
      uid: '', // will be set by makeStreamRequest
    }
    await this.makeStreamRequest<Response>(request)
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

  updateContextValues(newValues: Record<string, string | number | boolean>) {
    this.contextValues = { ...this.contextValues, ...newValues }
  }
}
