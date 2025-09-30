class AudioRecordingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    this.sampleRate = options.processorOptions?.sampleRate || 16000
    this.channels = options.processorOptions?.channels || 1
    this.bitDepth = options.processorOptions?.bitDepth || 16
    this.bufferSize = 4096
    this.buffer = new Float32Array(this.bufferSize)
    this.bufferIndex = 0

    console.log('AudioRecordingProcessor initialized', {
      sampleRate: this.sampleRate,
      channels: this.channels,
      bitDepth: this.bitDepth,
    })
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]

    if (input && input.length > 0) {
      const inputChannel = input[0]

      // Process each sample
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex++] = inputChannel[i]

        // When buffer is full, send it to main thread
        if (this.bufferIndex >= this.bufferSize) {
          this.sendAudioData()
          this.bufferIndex = 0
        }
      }
    }

    return true
  }

  sendAudioData() {
    // Convert float32 to int16 for efficiency
    const int16Array = new Int16Array(this.bufferSize)
    let hasNonZero = false
    for (let i = 0; i < this.bufferSize; i++) {
      // Clamp to [-1, 1] and convert to 16-bit integer
      const clamped = Math.max(-1, Math.min(1, this.buffer[i]))
      int16Array[i] = Math.round(clamped * 32767)
      if (int16Array[i] !== 0) hasNonZero = true
    }
    // Only send if buffer is not all zeros
    if (!hasNonZero) {
      // Optionally: log or debug here
      return
    }
    // Send as ArrayBuffer to main thread
    this.port.postMessage({
      type: 'audio-data',
      data: int16Array.buffer,
    })
  }
}

registerProcessor('audio-recording-processor', AudioRecordingProcessor)
