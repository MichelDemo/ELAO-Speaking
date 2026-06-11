/**
 * Player audio pour les chunks PCM 16-bit 24kHz reçus de Deepgram Aura via SSE.
 * Gère une queue : on enchaîne les chunks au fur et à mesure qu'ils arrivent.
 *
 * Session recording: every TTS chunk is routed to both the speakers
 * (ctx.destination) AND a MediaStreamDestinationNode (recordingDest).
 * Call addMicStream() to also route the user's mic into recordingDest,
 * then getRecordingStream() to hand the combined (TTS + mic) stream to
 * SessionRecorder. This produces a full-session recording of both sides.
 */

export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  /** Receives both TTS chunks and mic audio for the session recording. */
  private recordingDest: MediaStreamAudioDestinationNode | null = null;
  private nextStartTime = 0;
  private isPlaying = false;
  private onAmplitudeChange?: (amp: number) => void;

  constructor(onAmplitudeChange?: (amp: number) => void) {
    this.onAmplitudeChange = onAmplitudeChange;
  }

  /**
   * Call immediately after construction, while still inside the user-gesture
   * handler (before any await). Creates and resumes the AudioContext eagerly so
   * Chrome's autoplay policy cannot block it later when audio chunks arrive.
   */
  init() {
    this.ensureContext();
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      // No explicit sampleRate — let the browser use its native rate (44100/48000).
      // Forcing 24000 Hz on hardware running at a different rate causes the OS
      // to resample at the driver level, which introduces quantisation noise.
      this.audioContext = new AudioContext();
      this.recordingDest = this.audioContext.createMediaStreamDestination();
      this.nextStartTime = this.audioContext.currentTime;
    }
    // Call resume() fire-and-forget. Scheduled sources are queued by the Web
    // Audio engine and play correctly once the context becomes "running".
    // We must NOT await here — making playChunk async causes a race where
    // concurrent chunks all read nextStartTime before any of them updates it,
    // which schedules them all at the same moment and causes distortion.
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  /**
   * Route a microphone MediaStream into the recording destination.
   * The mic audio goes to recordingDest only — NOT to ctx.destination —
   * so it is captured in the session recording without feeding back to speakers.
   * Call once after Deepgram starts (which provides the mic stream).
   */
  addMicStream(micStream: MediaStream) {
    const ctx = this.ensureContext();
    if (!this.recordingDest) return;
    const source = ctx.createMediaStreamSource(micStream);
    // Slight gain boost so mic voice sits at roughly the same level as TTS.
    const gain = ctx.createGain();
    gain.gain.value = 1.4;
    source.connect(gain);
    gain.connect(this.recordingDest);
  }

  /**
   * Returns the combined TTS + mic stream for use by SessionRecorder.
   * Available after init() has been called.
   */
  getRecordingStream(): MediaStream | null {
    return this.recordingDest?.stream ?? null;
  }

  /**
   * Reçoit un chunk PCM linear16 (Int16) 24 kHz en base64,
   * le convertit en Float32 et le programme dans la timeline.
   * Synchronous — must stay synchronous to avoid scheduling races.
   */
  playChunk(base64Pcm: string) {
    const ctx = this.ensureContext();

    // base64 → bytes → Int16 → Float32
    const bytes = Uint8Array.from(atob(base64Pcm), (c) => c.charCodeAt(0));
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const float32 = new Float32Array(int16.length);
    let sumSq = 0;
    for (let i = 0; i < int16.length; i++) {
      const s = int16[i] / 32768;
      float32[i] = s;
      sumSq += s * s;
    }

    // 5 ms fade-in + fade-out (120 samples at 24 kHz) to smooth any remaining
    // waveform discontinuity at sentence boundaries. Safe here because each
    // buffer is a complete sentence — no mid-waveform splits.
    const ramp = Math.min(120, float32.length >> 2);
    for (let i = 0; i < ramp; i++) {
      float32[i] *= i / ramp;
      float32[float32.length - 1 - i] *= i / ramp;
    }

    // RMS pour piloter l'amplitude de la bouche de l'avatar
    const rms = Math.sqrt(sumSq / int16.length);
    this.onAmplitudeChange?.(Math.min(1, rms * 4));

    // createBuffer at the source rate (24 kHz). The Web Audio API resamples
    // transparently to the context's native rate when connecting to destination.
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Route to speakers AND the session recording destination.
    source.connect(ctx.destination);
    if (this.recordingDest) source.connect(this.recordingDest);

    // If we've fallen behind real-time (e.g. a hiccup), add a 20 ms lookahead
    // so the audio engine has time to prepare the buffer before playback.
    const now = ctx.currentTime;
    const startAt = this.nextStartTime > now ? this.nextStartTime : now + 0.02;
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.isPlaying = true;

    source.onended = () => {
      if (ctx.currentTime >= this.nextStartTime - 0.05) {
        this.isPlaying = false;
        this.onAmplitudeChange?.(0);
      }
    };
  }

  stop() {
    this.audioContext?.close();
    this.audioContext = null;
    this.recordingDest = null;
    this.nextStartTime = 0;
    this.isPlaying = false;
  }
}
