export class AudioStreamer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private queue: Float32Array[] = [];
  private sampleRate = 24000;
  private scheduledTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  async init(sampleRate = 24000) {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (e) {}
    }
    this.sampleRate = sampleRate;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 64;
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    this.analyser.connect(this.audioContext.destination);

    this.scheduledTime = 0;
    this.queue = [];
    this.activeSources = [];
  }

  getFrequencies(numBins: number = 5): number[] {
    if (!this.analyser || !this.dataArray) return Array(numBins).fill(0);
    this.analyser.getByteFrequencyData(this.dataArray as any);
    const result = [];
    const step = Math.floor(this.dataArray.length / numBins);
    for (let i = 0; i < numBins; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += this.dataArray[i * step + j];
      }
      result.push((sum / step) / 255);
    }
    return result;
  }

  addPCM16(base64: string) {
    if (!this.audioContext) return;
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const view = new DataView(buffer);
    for (let i = 0; i < binary.length; i++) {
        view.setUint8(i, binary.charCodeAt(i));
    }
    const int16Array = new Int16Array(buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
    }
    this.queue.push(float32Array);
    this.drainQueue();
  }

  private drainQueue() {
    if (!this.audioContext) return;
    while (this.queue.length > 0) {
      const chunk = this.queue.shift()!;
      const audioBuffer = this.audioContext.createBuffer(1, chunk.length, this.sampleRate);
      audioBuffer.getChannelData(0).set(chunk);
      
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.analyser || this.audioContext.destination);
      
      const currentTime = this.audioContext.currentTime;
      if (this.scheduledTime < currentTime) {
        this.scheduledTime = currentTime + 0.01; // Reduced safety buffer from 0.02 to 0.01
      }
      
      source.start(this.scheduledTime);
      this.scheduledTime += audioBuffer.duration;
      
      source.onended = () => {
        this.activeSources = this.activeSources.filter(s => s !== source);
      };
      this.activeSources.push(source);
    }
  }

  stop() {
    this.queue = [];
    this.activeSources.forEach(s => {
      try {
        s.stop();
        s.disconnect();
      } catch (e) {}
    });
    this.activeSources = [];
    this.scheduledTime = 0;
  }
}

export class AmbientConversationBed {
  private audioContext: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private baseVolume = 0.2;
  private isDucked = false;

  async start(volume = 0.2) {
    this.baseVolume = this.clampVolume(volume);

    if (this.audioContext && this.audioContext.state !== 'closed') {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.applyGain();
      return;
    }

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    let buffer: AudioBuffer;
    try {
      const resp = await fetch('/office.mp3');
      const arrayBuffer = await resp.arrayBuffer();
      buffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error('Failed to load office.mp3', e);
      return;
    }

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;

    this.gain = this.audioContext.createGain();
    this.gain.gain.value = 0;

    this.source.connect(this.gain);
    this.gain.connect(this.audioContext.destination);
    this.source.start();
    this.applyGain();
  }

  setVolume(volume: number) {
    this.baseVolume = this.clampVolume(volume);
    this.applyGain();
  }

  duck(shouldDuck: boolean) {
    this.isDucked = shouldDuck;
    this.applyGain();
  }

  private clampVolume(volume: number) {
    return Math.max(0, Math.min(0.2, Number.isFinite(volume) ? volume : 0.2));
  }

  private applyGain() {
    if (!this.audioContext || !this.gain) return;
    const target = this.isDucked ? this.baseVolume * 0.18 : this.baseVolume;
    this.gain.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.35);
  }

  stop() {
    if (this.source) {
      try {
        this.source.stop();
        this.source.disconnect();
      } catch (e) {}
    }

    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch (e) {}
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {}
    }

    this.audioContext = null;
    this.source = null;
    this.gain = null;
    this.isDucked = false;
  }
}

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentSink: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private killed = false;
  private onData: (base64: string) => void;

  constructor(onData: (base64: string) => void) {
    this.onData = onData;
  }

  async start() {
    this.killed = false;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } 
    });
    
    if (!this.audioContext) return;
    
    const source = this.audioContext.createMediaStreamSource(this.stream);
    
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 64;
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    source.connect(this.analyser);

    this.processor = this.audioContext.createScriptProcessor(1024, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (this.killed) return; // Bail immediately if stopped
      const input = e.inputBuffer.getChannelData(0);
      const resampled = this.downsampleBuffer(input, this.audioContext!.sampleRate, 16000);
      const output = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) {
        const s = Math.max(-1, Math.min(1, resampled[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      const buffer = new ArrayBuffer(output.length * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < output.length; i++) {
        view.setInt16(i * 2, output[i], true);
      }
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      try {
        this.onData(btoa(binary));
      } catch {} // Silently ignore errors after session close
    };
    
    this.analyser.connect(this.processor);
    this.silentSink = this.audioContext.createGain();
    this.silentSink.gain.value = 0;
    this.processor.connect(this.silentSink);
    this.silentSink.connect(this.audioContext.destination);
  }

  private downsampleBuffer(buffer: Float32Array, inSampleRate: number, outSampleRate: number): Float32Array {
    if (outSampleRate === inSampleRate) return buffer;
    if (outSampleRate > inSampleRate) {
      return buffer;
    }
    const sampleRateRatio = inSampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  getFrequencies(numBins: number = 5): number[] {
    if (!this.analyser || !this.dataArray) return Array(numBins).fill(0);
    this.analyser.getByteFrequencyData(this.dataArray as any);
    const result = [];
    const step = Math.floor(this.dataArray.length / numBins);
    for (let i = 0; i < numBins; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += this.dataArray[i * step + j];
      }
      result.push((sum / step) / 255);
    }
    return result;
  }

  stop() {
    this.killed = true;
    this.onData = () => {}; // Prevent any queued onaudioprocess callbacks from calling the original handler
    if (this.processor && this.audioContext) {
      try {
        this.processor.disconnect();
      } catch (e) {}
    }
    if (this.silentSink) {
      try {
        this.silentSink.disconnect();
      } catch (e) {}
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (e) {}
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {}
      });
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        console.error("Failed to close AudioContext:", e);
      }
    }
    this.audioContext = null;
    this.stream = null;
    this.processor = null;
    this.silentSink = null;
    this.analyser = null;
    this.dataArray = null;
  }
}
