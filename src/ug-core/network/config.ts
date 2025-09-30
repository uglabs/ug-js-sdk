// Environment configurations

const LOCAL_API_URL = 'http://localhost:8000/api'
// Load API_KEY from environment variables, fallback to empty string if not set
const API_KEY = process.env.API_KEY || ''

export const ENV_CONFIGS = {
  local: {
    apiUrl: LOCAL_API_URL,
    apiKey: API_KEY,
    hostnamePattern: (hostname: string) => hostname.includes('localhost'),
  },
}
