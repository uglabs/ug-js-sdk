import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios'
import { ENV_CONFIGS } from './config'
import LocalStorage from '../core/localStorage'
const REQUEST_ID_HEADER = 'x-request-id'

class Api {
  private _authToken?: string
  private _requestId: string | null = null // Stores the latest X-Request-ID
  apiUrl: string
  private _apiKey?: string
  apiClient: AxiosInstance

  constructor({ apiUrl }: { apiUrl?: string } = {}) {
    // If user provides environment variables, use those instead of PRD/DEV logic
    const userApiUrl = process.env.API_URL

    const isEnvVariablesSet = userApiUrl
    if (isEnvVariablesSet) {
      this.apiUrl = userApiUrl
    } else {
      const hostname = window.location.hostname
      const envConfig =
        Object.values(ENV_CONFIGS).find((config) => config.hostnamePattern(hostname)) ||
        ENV_CONFIGS.local
      this.apiUrl = apiUrl || envConfig.apiUrl
      this._apiKey = envConfig.apiKey
      this._authToken = LocalStorage.getWithExpiry<string>('authToken') || undefined
    }

    this.apiClient = axios.create({
      baseURL: this.apiUrl,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    })
    this.setInterceptors()
  }

  private setInterceptors() {
    // Add authentication check interceptor
    this.apiClient.interceptors.request.use(
      async (config) => {
        // Skip auth check to prevent stack overflow
        if (config.url?.includes('/auth/login')) {
          return config
        }

        const isAuthenticated = Boolean(LocalStorage.getWithExpiry('authToken') || this.authToken)
        if (!isAuthenticated) {
          try {
            await this.loginWithApiKey(this._apiKey || '')
          } catch (error) {
            console.error('Failed to authenticate with client credentials:', error)
            // Clear any invalid tokens
            LocalStorage.removeItem('authToken')
            this._authToken = undefined
          }
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    this.apiClient.interceptors.response.use(
      (response: AxiosResponse) => {
        this.updatedRequestFromResponse(response)
        return response
      },
      (error: any) => {
        if (error.response) {
          this.updatedRequestFromResponse(error.response)
        }
        return Promise.reject(error)
      }
    )

    // Original interceptor that calls handleError on error responses
    this.apiClient.interceptors.response.use((response) => response, this.handleError.bind(this))

    this.apiClient.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          try {
            const body = JSON.stringify(error.response.data)

            // Clear auth token if we get a 401 response
            if (axios.isAxiosError(error) && error.response?.status === 401) {
              LocalStorage.removeItem('authToken')
              this._authToken = undefined
            }

            return Promise.reject(error)
          } catch (loggingError) {
            console.error(loggingError)
            return Promise.reject(loggingError)
          }
        }
        return Promise.reject(error)
      }
    )
  }

  public async verifyAuthentication(): Promise<void> {
    await this.getMe()
  }

  private updatedRequestFromResponse(response: AxiosResponse) {
    this.updateRequestId(response.headers[REQUEST_ID_HEADER] ?? '')
    return response
  }

  private handleError(error: AxiosError) {
    return Promise.reject(error)
  }

  public get authToken(): string | undefined {
    return this._authToken
  }

  public set authToken(newAuthToken: string | undefined) {
    if (newAuthToken) {
      LocalStorage.setWithExpiry('authToken', newAuthToken)
    } else {
      LocalStorage.removeItem('authToken')
    }
    this._authToken = newAuthToken
    if (this.apiClient) {
      this.apiClient.defaults.headers['Authorization'] = `Bearer ${newAuthToken}`
    }
  }

  public get requestId(): string | null {
    return this._requestId
  }

  private updateRequestId(newRequestId: string) {
    if (newRequestId) {
      this._requestId = newRequestId
    }
  }

  // Exchanges api key with access token
  async loginWithApiKey(apiKey?: string | null): Promise<string> {
    const response = await this.apiClient.post('/auth/login', {
      api_key: apiKey || this._apiKey,
    })
    this.authToken = response.data.access_token
    this.apiClient.defaults.headers.common['Authorization'] = `Bearer ${this.authToken}`
    return this.authToken || ''
  }

  public async getMe(): Promise<any> {
    const response = await this.apiClient.get('/users/me')
    return response.data
  }
}

export default Api
