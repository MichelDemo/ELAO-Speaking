/**
 * Browser-side audio conversion: any MediaRecorder blob → WAV 16 kHz mono PCM16.
 *
 * Why this exists: Chrome's MediaRecorder produces audio/webm;codecs=opus, but
 * Azure's REST short-audio endpoint only accepts WAV/PCM and OGG/OPUS — WebM is
 * not a supported container. Sending webm made Azure reject every pronunciation
 * request, so the accurate pass-2 scores never replaced the lenient free-speech
 * pass-1 scores (root cause of the "everything shows 100%" bug).
 *
 * The browser that recorded the blob can always decode it (decodeAudioData
 * handles webm/opus natively), so we decode → resample to 16 kHz mono via
 * OfflineAudioContext → write a standard 44-byte WAV header + PCM16 samples.
 */

const TARGET_RATE = 16000;

export async function blobToWav16kMono(blob: Blob): Promise<Blob> {
  const encoded = await blob.arrayBuffer();

  // Decode at the context's native rate, then resample offline.
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(encoded);
  } finally {
    void decodeCtx.close();
  }

  // OfflineAudioContext with 1 channel downmixes and resamples in one pass.
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  // 44-byte canonical WAV header + 16-bit little-endian PCM.
  const dataSize = samples.length * 2;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);              // fmt chunk size
  view.setUint16(20, 1, true);               // PCM
  view.setUint16(22, 1, true);               // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true);               // block align
  view.setUint16(34, 16, true);              // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([wav], { type: "audio/wav" });
}
