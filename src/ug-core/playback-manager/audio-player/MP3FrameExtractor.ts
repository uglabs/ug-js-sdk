export class MP3FrameExtractor {
  private buffer: number[] = []
  private static FrameSync = [0xff, 0xfb]
  private static BitrateTable = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
  ]
  private static SamplingRateTable = [44100, 48000, 32000]

  public feedAndExtractCompleteFrames(chunkBytes: Uint8Array): {
    frames: Uint8Array[]
    remainingData: Uint8Array
  } {
    const completeFrames: Uint8Array[] = []
    this.buffer.push(...Array.from(chunkBytes))

    let i = 0
    while (i + 4 <= this.buffer.length) {
      if (this.buffer[i] === 0xff && (this.buffer[i + 1] & 0xf0) === 0xf0) {
        const header = this.buffer.slice(i, i + 4)
        const frameLen = this.getFrameLength(header)

        if (frameLen > 0 && i + frameLen <= this.buffer.length) {
          const frame = this.buffer.slice(i, i + frameLen)
          completeFrames.push(new Uint8Array(frame))
          i += frameLen
        } else {
          break // wait for more data
        }
      } else {
        i += 1 // skip until sync
      }
    }

    // Get remaining data
    const remainingData = new Uint8Array(this.buffer.slice(i))

    // Remove consumed bytes
    this.buffer = this.buffer.slice(i)

    return {
      frames: completeFrames,
      remainingData,
    }
  }

  private getFrameLength(header: number[]): number {
    const bitrateIdx = (header[2] >> 4) & 0x0f
    const samplingRateIdx = (header[2] >> 2) & 0x03
    const paddingBit = (header[2] >> 1) & 0x01

    if (bitrateIdx === 0x0f || samplingRateIdx === 0x03) return -1

    const bitrate = MP3FrameExtractor.BitrateTable[bitrateIdx] * 1000
    const samplingRate = MP3FrameExtractor.SamplingRateTable[samplingRateIdx]

    const frameLength = Math.floor((144 * bitrate) / samplingRate) + paddingBit
    return frameLength
  }
}
