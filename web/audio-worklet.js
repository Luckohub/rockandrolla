// Rockanrola - AudioWorklet that plays the static core's native PCM.
//
// The core produces signed 16-bit stereo at 32,040 Hz (converted to float on
// the main thread). This processor buffers it and resamples to the device
// rate with 4-point Hermite interpolation, the same default the upstream
// Windows frontend uses. It reports its fill level so the page can keep the
// game clock and the audio clock together without SharedArrayBuffer.

class RockanrolaAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.inputRate = o.inputRate || 32040;
    this.capacity = o.capacity || 32768; // stereo frames
    this.prebuffer = o.prebuffer || 1600;
    this.buffer = new Float32Array(this.capacity * 2);
    this.read = 0;        // integer read frame
    this.frac = 0;        // fractional position between read and read+1
    this.write = 0;
    this.count = 0;       // stereo frames stored
    this.step = this.inputRate / sampleRate;
    this.playing = false;
    this.underruns = 0;
    this.dropped = 0;
    this.blocks = 0;
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'pcm') this.push(msg.samples);
      else if (msg.type === 'clear') this.clear();
    };
  }

  clear() {
    this.read = 0; this.write = 0; this.count = 0; this.frac = 0;
    this.playing = false;
  }

  push(samples) {
    const frames = samples.length >> 1;
    for (let i = 0; i < frames; i++) {
      if (this.count >= this.capacity) {
        this.read = (this.read + 1) % this.capacity;
        this.count--;
        this.dropped++;
      }
      const w = this.write * 2;
      this.buffer[w] = samples[i * 2];
      this.buffer[w + 1] = samples[i * 2 + 1];
      this.write = (this.write + 1) % this.capacity;
      this.count++;
    }
  }

  sample(offset, channel) {
    let index = this.read + offset;
    if (index < 0) index += this.capacity;
    return this.buffer[(index % this.capacity) * 2 + channel];
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    const n = left.length;
    if (!this.playing && this.count >= this.prebuffer) this.playing = true;
    for (let i = 0; i < n; i++) {
      // Hermite needs read-1 .. read+2.
      if (!this.playing || this.count < 3) {
        if (this.playing) { this.playing = false; this.underruns++; }
        left[i] = 0; right[i] = 0;
        continue;
      }
      const t = this.frac;
      for (let c = 0; c < 2; c++) {
        const xm1 = this.sample(-1, c), x0 = this.sample(0, c);
        const x1 = this.sample(1, c), x2 = this.sample(2, c);
        const c1 = 0.5 * (x1 - xm1);
        const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
        const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
        const v = ((c3 * t + c2) * t + c1) * t + x0;
        if (c === 0) left[i] = v; else right[i] = v;
      }
      this.frac += this.step;
      while (this.frac >= 1) {
        this.frac -= 1;
        this.read = (this.read + 1) % this.capacity;
        this.count--;
      }
    }
    if (++this.blocks % 16 === 0) {
      this.port.postMessage({ type: 'level', frames: this.count,
        underruns: this.underruns, dropped: this.dropped });
    }
    return true;
  }
}

registerProcessor('rockanrola-audio', RockanrolaAudio);
