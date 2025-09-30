import { EventEmitter } from '@/ug-core/core/EventEmitter'
import { AvatarManagerEvents, IAvatar } from '../types'
import { DefaultLogger, StyleOrange } from '@/ug-core/core/Logger'

/**
 * Can help drive an animated character by signaling what animation should be triggered
 */
export class AvatarManager extends EventEmitter implements IAvatar {
  private animationLayers: Map<number, string> = new Map()
  private layerPriority = ['mouth', 'facial', 'body', 'idle']
  private thinkToggle: boolean = false

  constructor() {
    const logger = new DefaultLogger({ category: '🧒 AvatarManager', style: StyleOrange })
    super(logger)
  }

  playIdle(): void {
    this.playAnimation('body_idle', 0, true)
  }

  playListen(): void {
    this.playAnimation('body_idle_listen', 0, true)
  }

  playTalk(): void {
    this.playAnimation('body_talk_to_user_loop', 0, true)
  }

  playThink(): void {
    // Alternate between two think animations for variety
    const thinkAnim = this.thinkToggle ? 'body_idle_think2' : 'body_idle_think'
    this.thinkToggle = !this.thinkToggle
    this.playAnimation(thinkAnim, 0, true)
  }

  playLaugh(): void {
    this.playAnimation('body_laugh', 0, true)
  }

  playWaving(): void {
    this.playAnimation('body_waving', 0, false)
  }

  playViseme(visemeName: string): void {
    this.playAnimation(visemeName, 1, false) // Assume visemes are on track 1
  }

  async playAnimation(name: string, layer = 0, loop = true): Promise<void> {
    this.animationLayers.set(layer, name)
    await this.emit(AvatarManagerEvents.AnimationChanged, { name, layer, loop })
    this.logger.debug(`Playing animation: ${name} on layer ${layer} (loop: ${loop})`)
  }

  async stopAnimation(layer = 0): Promise<void> {
    this.animationLayers.delete(layer)
    await this.emit(AvatarManagerEvents.AnimationStopped, { layer })
  }
}
