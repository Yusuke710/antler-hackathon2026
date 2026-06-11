import { NextResponse } from "next/server";
import { fallbackFinalize, IntakeDraft, TranscriptMessage } from "@/lib/intake";

export const runtime = "nodejs";

const finalizeSchema = {
  name: "electrician_booking",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["booking"],
    properties: {
      booking: {
        type: "object",
        additionalProperties: false,
        required: [
          "customerName",
          "phone",
          "phoneConfirmed",
          "suburb",
          "address",
          "jobType",
          "existingOrNew",
          "bookingType",
          "bookedTime",
          "inspectionNeeded",
          "urgency",
          "safetyIssue",
          "reason"
        ],
        properties: {
          customerName: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          phoneConfirmed: { type: "boolean" },
          suburb: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          jobType: { type: ["string", "null"] },
          existingOrNew: { type: ["string", "null"], enum: ["existing", "new", "unknown", null] },
          bookingType: { type: ["string", "null"], enum: ["Easy job", "Inspection job", "Urgent safety", null] },
          bookedTime: { type: ["string", "null"] },
          inspectionNeeded: { type: "boolean" },
          urgency: { type: ["string", "null"], enum: ["Normal", "Urgent", "Review needed", null] },
          safetyIssue: { type: ["string", "null"] },
          reason: { type: ["string", "null"] }
        }
      }
    }
  }
};

function polishBooking(booking: IntakeDraft): IntakeDraft {
  const safety = booking.safetyIssue?.toLowerCase() ?? "";
  const noSafetyReported =
    safety.startsWith("no ") ||
    safety.includes("none") ||
    (safety.includes("no sparks") && safety.includes("burning"));

  const polished = {
    ...booking,
    safetyIssue: noSafetyReported ? "None reported" : booking.safetyIssue
  };

  if (!polished.reason) {
    if (polished.bookingType === "Easy job") {
      polished.reason =
        "Customer described a like-for-like residential replacement and did not report sparks, burning smell, water exposure, outage, shock, or tripping.";
    } else if (polished.bookingType === "Urgent safety") {
      polished.reason =
        "Customer reported a potential safety issue, so the job should be treated as urgent and reviewed by an electrician.";
    } else {
      polished.reason =
        "The job may require new wiring, fault finding, outdoor work, or electrician review before the work can be confirmed.";
    }
  }

  return polished;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages: TranscriptMessage[];
  };

  const messages = body.messages ?? [];

  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
          messages: [
            {
              role: "system",
              content:
                "Extract the final electrician booking from this call transcript. Use your judgement to classify bookingType as Easy job, Inspection job, or Urgent safety. Extract suburb/area and address separately. If a field was not stated, infer only when obvious from the confirmed booking; otherwise use null. The caller number is 0404 221 908 if the customer confirmed the phone number is good."
            },
            {
              role: "user",
              content: messages.map((message) => `${message.speaker.toUpperCase()}: ${message.text}`).join("\n")
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: finalizeSchema
          },
          max_completion_tokens: 900
        })
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content) as { booking: IntakeDraft };
          return NextResponse.json({ booking: polishBooking(parsed.booking) });
        }
      } else {
        console.error("OpenAI finalize error", await response.text());
      }
    } catch (error) {
      console.error("OpenAI finalize exception", error);
    }
  }

  const booking = polishBooking(fallbackFinalize(messages));
  return NextResponse.json({ booking });
}
