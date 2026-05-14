"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Room, RoomEvent, Track } from "livekit-client";

export interface LiveAvatarHandle {
  /** Send a base64-encoded PCM 16-bit 24 kHz audio chunk to the avatar. */
  sendAudio: (base64pcm: string) => void;
  /** Signal end of the current speaking turn. */
  speakEnd: () => void;
  /** Interrupt the avatar mid-speech. */
  interrupt: () => void;
  /** Tell the avatar to show a listening pose. */
  startListening: () => void;
  /** Return the avatar to idle from listening. */
  stopListening: () => void;
}

interface LiveAvatarProps {
  onAmplitude?: (amp: number) => void;
}

interface SessionData {
  session_id: string;
  livekit_url: string;
  livekit_token: string;
  ws_url: string;
}

let _eventCounter = 0;
function nextId() {
  return `evt-${++_eventCounter}-${Date.now()}`;
}

export const LiveAvatar = forwardRef<LiveAvatarHandle, LiveAvatarProps>(
  function LiveAvatar({ onAmplitude }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const wsReadyRef = useRef(false);
    const rafRef = useRef<number>(0);
    const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");

    useImperativeHandle(ref, () => ({
      sendAudio(base64pcm: string) {
        const ws = wsRef.current;
        if (!ws || !wsReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "agent.speak", audio: base64pcm }));
      },
      speakEnd() {
        const ws = wsRef.current;
        if (!ws || !wsReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "agent.speak_end", event_id: nextId() }));
      },
      interrupt() {
        const ws = wsRef.current;
        if (!ws || !wsReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "agent.interrupt" }));
      },
      startListening() {
        const ws = wsRef.current;
        if (!ws || !wsReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "agent.start_listening", event_id: nextId() }));
      },
      stopListening() {
        const ws = wsRef.current;
        if (!ws || !wsReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "agent.stop_listening", event_id: nextId() }));
      },
    }));

    useEffect(() => {
      let mounted = true;
      const room = new Room();

      async function init() {
        const res = await fetch("/api/liveavatar-session", { method: "POST" });
        if (!mounted) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Unknown" }));
          console.error("LiveAvatar session error:", body.error);
          setStatus("error");
          return;
        }

        const session: SessionData = await res.json();
        if (!mounted) return;

        // ── WebSocket for audio control ─────────────────────────────────────
        const ws = new WebSocket(session.ws_url);
        wsRef.current = ws;

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string);
            if (msg.type === "session.state_updated" && msg.state === "connected") {
              wsReadyRef.current = true;
              // Keep-alive every 30 s (idle timeout is 5 min)
              keepAliveRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "session.keep_alive", event_id: nextId() }));
                }
              }, 30_000);
            }
          } catch {}
        };
        ws.onerror = (e) => console.warn("LiveAvatar WS error:", e);

        // ── LiveKit for video (and optionally audio amplitude) ──────────────
        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (!mounted) return;

          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            if (mounted) setStatus("ready");
          }

          if (track.kind === Track.Kind.Audio && onAmplitude) {
            try {
              const audioEl = document.createElement("audio");
              audioEl.autoplay = true;
              track.attach(audioEl);

              const ctx = new AudioContext();
              const src = ctx.createMediaElementSource(audioEl);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 512;
              src.connect(analyser);
              src.connect(ctx.destination);

              const buf = new Uint8Array(analyser.frequencyBinCount);
              const tick = () => {
                if (!mounted) return;
                analyser.getByteFrequencyData(buf);
                const rms = Math.sqrt(
                  buf.reduce((s, v) => s + (v / 255) ** 2, 0) / buf.length
                );
                onAmplitude(rms);
                rafRef.current = requestAnimationFrame(tick);
              };
              rafRef.current = requestAnimationFrame(tick);
            } catch (e) {
              console.warn("LiveAvatar audio analyser:", e);
            }
          }
        });

        await room.connect(session.livekit_url, session.livekit_token);
      }

      init().catch((e) => {
        console.error("LiveAvatar init:", e);
        if (mounted) setStatus("error");
      });

      return () => {
        mounted = false;
        cancelAnimationFrame(rafRef.current);
        if (keepAliveRef.current) clearInterval(keepAliveRef.current);
        wsRef.current?.close();
        wsRef.current = null;
        wsReadyRef.current = false;
        room.disconnect();
      };
    }, [onAmplitude]);

    return (
      <div style={{ width: "100%", height: "100%", background: "#000", position: "relative" }}>
        {status === "connecting" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 12,
              color: "#94a3b8",
              background: "#0f172a",
            }}
          >
            <div style={{ fontSize: 32 }}>⏳</div>
            <div style={{ fontSize: 14 }}>Connexion avatar…</div>
          </div>
        )}
        {status === "error" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ef4444",
              fontSize: 14,
              background: "#0f172a",
            }}
          >
            Avatar LiveAvatar indisponible
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: status === "ready" ? 1 : 0,
            transition: "opacity 0.5s",
          }}
        />
      </div>
    );
  }
);
