import { InteractRequest } from "../types"

export interface IConversationManager {
  initialize(): Promise<void>
  startListening(): Promise<void>
  stopListening(): Promise<void>
  interact(request: InteractRequest): Promise<void> // Main place to converse
  interrupt(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  forceInputComplete(): Promise<void>
  stop(): Promise<void>
  toggleTextOnlyInput(isTextOnly: boolean): Promise<void>
  on(event: string, listener: (...args: any[]) => void): void
}
