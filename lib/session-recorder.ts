/**
 * Records the microphone for the duration of a session.
 * Returns a Blob (webm/opus) on stop().
 * Runs independently of Azure STT — both can access the mic simultaneously.
 */
export class SessionRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
      this.chunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start(2000); // chunk every 2 s
    } catch (e) {
      console.warn("SessionRecorder: could not start", e);
    }
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder!.mimeType });
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(blob.size > 0 ? blob : null);
      };
      this.mediaRecorder.stop();
    });
  }
}
