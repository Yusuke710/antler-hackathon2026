"use client";

import { useConversation } from "@elevenlabs/react";
import {
  CalendarClock,
  Check,
  FileVideo,
  ImagePlus,
  Loader2,
  Mic,
  Phone,
  PhoneOff,
  Send,
  ShieldAlert,
  Sparkles,
  Volume2
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IntakeDraft, TranscriptMessage } from "@/lib/intake";

type MediaPreview = {
  name: string;
  type: string;
  url: string;
};

function newId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeElevenLabsMessage(message: unknown): TranscriptMessage | null {
  const raw = message as Record<string, unknown>;
  const maybeText = raw.message ?? raw.text ?? raw.transcript ?? raw.content;
  const text = typeof maybeText === "string" ? maybeText.trim() : "";
  if (!text) return null;
  if (!/[a-z0-9]/i.test(text)) return null;

  const source = String(raw.source ?? raw.role ?? raw.type ?? "").toLowerCase();
  const speaker = source.includes("user") ? "customer" : "agent";
  const isTentative = raw.is_final === false || raw.isFinal === false || source.includes("tentative");
  if (isTentative) return null;

  return {
    id: newId(),
    speaker,
    text
  };
}

function Field({ label, value }: { label: string; value: string | null | boolean }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{typeof value === "boolean" ? (value ? "Yes" : "No") : value ?? "Not captured"}</strong>
    </div>
  );
}

async function speak(text: string) {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) throw new Error("Could not play AI voice.");

  const url = URL.createObjectURL(await response.blob());
  try {
    const audio = new Audio(url);
    audio.volume = 1;
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Home() {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [booking, setBooking] = useState<IntakeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [media, setMedia] = useState<MediaPreview[]>([]);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const messagesRef = useRef<TranscriptMessage[]>([]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const playedAgentTextsRef = useRef<Set<string>>(new Set());
  const lastAcceptedSpeakerRef = useRef<"agent" | "customer" | null>(null);
  const ttsQueueRef = useRef(Promise.resolve());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  const handleMessage = useCallback((message: unknown) => {
    const normalized = normalizeElevenLabsMessage(message);
    if (!normalized) return;
    if (normalized.speaker === "agent" && lastAcceptedSpeakerRef.current === "agent") return;

    if (normalized.speaker === "agent" && !playedAgentTextsRef.current.has(normalized.text)) {
      playedAgentTextsRef.current.add(normalized.text);
      ttsQueueRef.current = ttsQueueRef.current
        .catch(() => undefined)
        .then(() => speak(normalized.text))
        .catch((ttsError) => setError(ttsError instanceof Error ? ttsError.message : "Could not play AI voice."));
    }

    lastAcceptedSpeakerRef.current = normalized.speaker;
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.speaker === normalized.speaker && last.text === normalized.text) return current;
      return [...current, normalized];
    });
  }, []);

  const conversation = useConversation({
    volume: 1,
    onConnect: () => setError(null),
    onDisconnect: () => undefined,
    onMessage: handleMessage,
    onError: (conversationError: unknown) => {
      setError(conversationError instanceof Error ? conversationError.message : "ElevenLabs conversation failed.");
    }
  });

  const isConnected = conversation.status === "connected";
  const isConnecting = conversation.status === "connecting";

  useEffect(() => {
    messagesRef.current = messages;
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages]);

  function startRecording(stream: MediaStream) {
    if (!window.MediaRecorder) return;
    recordingChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      setRecordingUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return blob.size > 0 ? URL.createObjectURL(blob) : null;
      });
      stream.getTracks().forEach((track) => track.stop());
    };
    recorderRef.current = recorder;
    recordingStreamRef.current = stream;
    recorder.start();
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    } else {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    }
    recorderRef.current = null;
    recordingStreamRef.current = null;
  }

  async function startCall() {
    setError(null);
    setBooking(null);
    setSmsSent(false);
    setMedia([]);
    setMessages([]);
    setRecordingUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    playedAgentTextsRef.current.clear();
    lastAcceptedSpeakerRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startRecording(stream);
      const response = await fetch("/api/elevenlabs/token", { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Could not get ElevenLabs signed URL.");
      }
      const { conversationToken, voiceId } = (await response.json()) as {
        conversationToken: string;
        voiceId: string | null;
      };
      const sessionOptions = {
        conversationToken,
        userId: "hackathon-demo-caller"
      };

      await conversation.startSession(
        voiceId
          ? {
              ...sessionOptions,
              connectionType: "webrtc",
              overrides: {
                tts: {
                  voiceId
                }
              }
            }
          : { ...sessionOptions, connectionType: "webrtc" }
      );
    } catch (startError) {
      stopRecording();
      setError(startError instanceof Error ? startError.message : "Could not start the voice call.");
    }
  }

  async function endCall() {
    setIsEnding(true);
    setError(null);

    try {
      if (isConnected || isConnecting) {
        await conversation.endSession();
      }
      stopRecording();

      const response = await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesRef.current })
      });

      if (!response.ok) throw new Error("Could not generate booking card.");
      const data = (await response.json()) as { booking: IntakeDraft };
      setBooking(data.booking);
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Could not end the call.");
    } finally {
      setIsEnding(false);
    }
  }

  function resetDemo() {
    setMessages([]);
    setBooking(null);
    setSmsSent(false);
    setMedia([]);
    setError(null);
    stopRecording();
    setRecordingUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    playedAgentTextsRef.current.clear();
    lastAcceptedSpeakerRef.current = null;
  }

  function handleMediaUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setMedia((current) => [
      ...current,
      ...files.map((file) => ({
        name: file.name,
        type: file.type,
        url: URL.createObjectURL(file)
      }))
    ]);
  }

  return (
    <main className="shell">
      <section className="phoneStage" aria-label="Phone call demo">
        <div className="phone">
          <div className="phoneNotch" />
          <div className="callHeader">
            <div className={`signal ${isConnected ? "live" : ""}`}>
              <Mic size={16} />
            </div>
          </div>

          <div className="caller">
            <div className="avatar">
              <Sparkles size={28} />
            </div>
            <h1>Yusuke Electrical</h1>
            <p>0404 221 908</p>
          </div>

          <div className="statusPill">
            {conversation.isSpeaking ? (
              <>
                <Volume2 size={15} /> Agent speaking
              </>
            ) : isConnected ? (
              <>
                <Mic size={15} /> Listening
              </>
            ) : (
              <>
                <Phone size={15} /> Ready
              </>
            )}
          </div>

          <div className="transcript" ref={transcriptRef}>
            {messages.length === 0 ? (
              <div className="emptyTranscript">
                <Phone size={22} />
                <span>Start the call and speak naturally.</span>
              </div>
            ) : (
              messages.map((message) => (
                <div className={`bubble ${message.speaker}`} key={message.id}>
                  <small>{message.speaker === "agent" ? "AI receptionist" : "Customer"}</small>
                  {message.text}
                </div>
              ))
            )}
          </div>

          {error ? <div className="phoneError">{error}</div> : null}

          <div className="callControls">
            {isConnected || isConnecting ? (
              <button className="roundButton end" onClick={endCall} disabled={isEnding}>
                {isEnding ? <Loader2 className="spin" size={24} /> : <PhoneOff size={25} />}
              </button>
            ) : (
              <button className="roundButton start" onClick={startCall} disabled={isEnding}>
                <Phone size={25} />
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className="sidePanel" aria-label="Booking result">
        <div className="panelTop">
          <div>
            <h2>New Booking</h2>
          </div>
          <button className="ghostButton" onClick={resetDemo} disabled={isConnected || isConnecting}>
            Reset
          </button>
        </div>

        {booking ? (
          <div className="bookingCard">
            <div className={`bookingType ${booking.bookingType === "Urgent safety" ? "urgent" : ""}`}>
              {booking.bookingType === "Urgent safety" ? <ShieldAlert size={18} /> : <CalendarClock size={18} />}
              {booking.bookingType ?? "Review needed"}
            </div>

            <div className="fieldGrid">
              <Field label="Customer" value={booking.customerName} />
              <Field label="Phone" value={booking.phone} />
              <Field label="Area" value={booking.suburb} />
              <Field label="Address" value={booking.address} />
              <Field label="Job type" value={booking.jobType} />
              <Field label="Booked time" value={booking.bookedTime} />
              <Field label="Inspection needed" value={booking.inspectionNeeded} />
              <Field label="Safety issue" value={booking.safetyIssue ?? "None reported"} />
            </div>

            <div className="reason">
              <span>Note</span>
              <p>{booking.reason ?? "Booking generated from the completed phone call."}</p>
            </div>

            <div className="recordingBox">
              <div>
                <strong>Call recording</strong>
                <span>{recordingUrl ? "Recorded during this browser call" : "No recording available"}</span>
              </div>
              {recordingUrl ? <audio controls src={recordingUrl} /> : null}
            </div>

            <div className="smsBox">
              <div>
                <strong>Optional media</strong>
                <span>{smsSent ? "Upload link sent by SMS" : "Send customer an upload link"}</span>
              </div>
              <button onClick={() => setSmsSent(true)}>
                {smsSent ? <Check size={17} /> : <Send size={17} />}
                {smsSent ? "Sent" : "Send SMS"}
              </button>
            </div>

            {smsSent ? (
              <div className="uploadBox">
                <label>
                  <ImagePlus size={18} />
                  Customer photo/video upload
                  <input accept="image/*,video/*" multiple onChange={handleMediaUpload} type="file" />
                </label>

                {media.length > 0 ? (
                  <div className="mediaGrid">
                    {media.map((item) => (
                      <div className="mediaItem" key={item.url}>
                        {item.type.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={item.name} src={item.url} />
                        ) : (
                          <div className="videoThumb">
                            <FileVideo size={24} />
                          </div>
                        )}
                        <span>{item.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="waitingCard">
            <CalendarClock size={30} />
            <h3>Booking card appears after the call ends.</h3>
            <p>Call Yusuke Electrical and the confirmed booking details will appear here after the call.</p>
          </div>
        )}
      </aside>
    </main>
  );
}
