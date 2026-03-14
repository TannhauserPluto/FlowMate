class PcmCaptureProcessor extends AudioWorkletProcessor {
  private chunkSize: number;
  private buffer: Float32Array;
  private writeIndex: number;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const fallbackSize = 1024;
    const size = options?.processorOptions?.chunkSize;
    this.chunkSize = typeof size === 'number' && size > 0 ? size : fallbackSize;
    this.buffer = new Float32Array(this.chunkSize);
    this.writeIndex = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'flush') return;
      if (this.writeIndex <= 0) {
        this.port.postMessage({ type: 'flush', frames: 0 });
        return;
      }
      const slice = this.buffer.slice(0, this.writeIndex);
      const buffer = new ArrayBuffer(slice.byteLength);
      new Float32Array(buffer).set(slice);
      this.port.postMessage(
        { type: 'flush', frames: this.writeIndex, buffer },
        [buffer],
      );
      this.buffer = new Float32Array(this.chunkSize);
      this.writeIndex = 0;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.writeIndex] = channel[i];
      this.writeIndex += 1;
      if (this.writeIndex >= this.chunkSize) {
        const chunk = this.buffer;
        this.port.postMessage({ type: 'chunk', buffer: chunk.buffer }, [chunk.buffer]);
        this.buffer = new Float32Array(this.chunkSize);
        this.writeIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
