/**
 * LocalStorage helper with expiry support.
 */
export class LocalStorage {
  static setItem(key: string, value: string): void {
    localStorage.setItem(key, value)
  }
  /**
   * Set item in localStorage with an expiry (default 55 minutes)
   */
  static setWithExpiry(key: string, value: unknown, ttl: number = 1 * 55 * 60 * 1000): void {
    const now = Date.now()

    const item = {
      value,
      expiry: now + ttl,
    }

    try {
      localStorage.setItem(key, JSON.stringify(item))
    } catch {
      // Swallow quota or serialization errors intentionally
    }
  }

  /**
   * Get item from localStorage with expiry check. Returns null if missing or expired.
   */
  static getWithExpiry<T = unknown>(key: string): T | null {
    const itemStr = localStorage.getItem(key)
    if (!itemStr) {
      return null
    }

    let parsed: { value: T; expiry: number } | null = null
    try {
      parsed = JSON.parse(itemStr) as { value: T; expiry: number }
    } catch (e) {
      // Malformed JSON — clean up and reraise
      localStorage.removeItem(key)
      throw e
    }

    const expiry = typeof parsed.expiry === 'number' ? parsed.expiry : 0
    const now = Date.now()

    if (now > expiry) {
      localStorage.removeItem(key)
      return null
    }

    return parsed.value
  }

  static removeItem(key: string): void {
    localStorage.removeItem(key)
  }
}

export default LocalStorage
