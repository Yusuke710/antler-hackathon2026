import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return NextResponse.json({ error: "Missing ElevenLabs API key or agent ID" }, { status: 400 });
  }

  const params = new URLSearchParams({
    agent_id: agentId,
    participant_name: "Hackathon demo caller"
  });
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?${params}`, {
    headers: { "xi-api-key": apiKey }
  });

  if (!response.ok) {
    return NextResponse.json({ error: await response.text() }, { status: response.status });
  }

  const data = (await response.json()) as { token: string };
  return NextResponse.json({
    conversationToken: data.token,
    voiceId: process.env.ELEVENLABS_USE_VOICE_OVERRIDE === "true" ? process.env.ELEVENLABS_VOICE_ID : null
  });
}
