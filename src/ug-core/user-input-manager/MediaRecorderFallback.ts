import { DefaultLogger, StyleBrown } from '@/ug-core/core/Logger'
import { ILogger } from '@/ug-core/types/index'

/**
 * It uses the MediaRecorder API to record audio from a MediaStream and emits audio data as ArrayBuffer.
 * This is useful for browsers that do not support the MediaRecorder API or when using HTTP connections.
 */
export class MediaRecorderFallback {
  private mediaRecorder: MediaRecorder | null = null
  private mimeType: string
  private onAudioData: (data: ArrayBuffer) => void
  private logger: ILogger = new DefaultLogger({
    category: '🎤 MediaRecorderFallback',
    style: StyleBrown,
  })

  constructor(mimeType: string, onAudioData: (data: ArrayBuffer) => void) {
    this.mimeType = mimeType
    this.onAudioData = onAudioData
  }

  initialize(mediaStream: MediaStream) {
    this.logger.debug('Initializing MediaRecorder for audio processing')
    this.mediaRecorder = new MediaRecorder(mediaStream, { mimeType: this.mimeType })
    this.logger.debug('MediaRecorder created, state:', this.mediaRecorder.state)
    this.mediaRecorder.ondataavailable = (event) => {
      this.logger.debug('ondataavailable called, size:', event.data.size)
      if (event.data.size > 0) {
        event.data.arrayBuffer().then((buffer) => {
          this.onAudioData(buffer)
        })
      }
    }
  }

  start() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
      this.mediaRecorder.start(100)
      this.logger.debug('MediaRecorder started')
    }
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
      this.logger.debug('MediaRecorder stopped')
    }
  }
}
