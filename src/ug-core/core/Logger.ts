import { ILogger } from '@/ug-core/types'

// Predefined style constants for logger categories
export const StyleRed = 'color: #f44336; font-weight: bold; font-size: larger'
export const StyleGreen = 'color: #4caf50; font-weight: bold; font-size: larger'
export const StyleBlue = 'color: #2196f3; font-weight: bold; font-size: larger'
export const StyleOrange = 'color: #ff9800; font-weight: bold; font-size: larger'
export const StylePurple = 'color: #ab47bc; font-weight: bold; font-size: larger'
export const StyleTeal = 'color: #009688; font-weight: bold; font-size: larger'
export const StylePink = 'color: #e91e63; font-weight: bold; font-size: larger'
export const StyleBrown = 'color: #795548; font-weight: bold; font-size: larger'
export const StyleGrey = 'color: #607d8b; font-weight: bold; font-size: larger'
export const StyleBlack = 'color: #222; font-weight: bold; font-size: larger'

export interface LoggerOptions {
  category?: string // e.g. "AudioRecorder"
  style?: string // e.g. "color: #ff9800; font-weight: bold; font-size: larger"
}

export class DefaultLogger implements ILogger {
  private category?: string
  private style: string

  constructor(options?: LoggerOptions) {
    this.category = options?.category
    this.style = options?.style || 'color: #2196f3; font-weight: bold; font-size: larger'
  }

  private getTimestamp(): string {
    const now = new Date()
    const pad = (n: number, width = 2) => n.toString().padStart(width, '0')
    return (
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.` +
      `${pad(now.getMilliseconds(), 3)}`
    )
  }

  private log(method: keyof Console, message: string, ...args: any[]) {
    const timestamp = this.getTimestamp()
    let msg = message
    const filteredArgs = args.filter((arg) => arg !== undefined)

    const processedArgs = filteredArgs.map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2) // pretty print
        } catch (e) {
          return '[Unserializable Object]'
        }
      }
      return arg
    })

    if (this.category) {
      if (!msg.startsWith(`[${this.category}]`)) {
        msg = `[${this.category}] ${msg}`
      }

      const match = msg.match(/^[[][^[\]]+[\]]\s?(.*)$/)
      if (match) {
        const logMsg = `%c${timestamp} %c[${this.category}]%c ${match[1]}`
        const timeStyle = 'color: #888; font-size: smaller;'
        const resetStyle = 'color: inherit;'
        if (processedArgs.length > 0) {
          ;(console[method] as any)(logMsg, timeStyle, this.style, resetStyle, ...processedArgs)
        } else {
          ;(console[method] as any)(logMsg, timeStyle, this.style, resetStyle)
        }
        return
      }
    }

    if (processedArgs.length > 0) {
      ;(console[method] as any)(`${timestamp} ${msg}`, ...processedArgs)
    } else {
      ;(console[method] as any)(`${timestamp} ${msg}`)
    }
  }

  info(message: string, ...args: any[]): void {
    this.log('info', message, ...args)
  }

  trace(message: string, ...args: any[]): void {
    this.log('trace', message, ...args)
  }

  debug(message: string, ...args: any[]): void {
    this.log('debug', message, ...args)
  }

  warn(message: string, ...args: any[]): void {
    this.log('warn', message, ...args)
  }

  error(message: string, ...args: any[]): void {
    this.log('error', message, ...args)
  }
}
