export type Speaker = "agent" | "customer";

export type TranscriptMessage = {
  id: string;
  speaker: Speaker;
  text: string;
};

export type BookingType = "Easy job" | "Inspection job" | "Urgent safety";

export type IntakeDraft = {
  customerName: string | null;
  phone: string | null;
  phoneConfirmed: boolean;
  suburb: string | null;
  address: string | null;
  jobType: string | null;
  existingOrNew: "existing" | "new" | "unknown" | null;
  bookingType: BookingType | null;
  bookedTime: string | null;
  inspectionNeeded: boolean;
  urgency: "Normal" | "Urgent" | "Review needed" | null;
  safetyIssue: string | null;
  reason: string | null;
};

export const CALLER_NUMBER = "0404 221 908";

export const BOOKING_SLOTS = {
  easy_job_slots: ["Tuesday 10:00 AM", "Wednesday 2:00 PM", "Friday 9:30 AM"],
  inspection_slots: ["Tuesday 3:30 PM", "Thursday 11:00 AM"],
  urgent_slots: ["Today 4:30 PM", "Tomorrow 8:00 AM"]
};

const blankBooking: IntakeDraft = {
  customerName: null,
  phone: null,
  phoneConfirmed: false,
  suburb: null,
  address: null,
  jobType: null,
  existingOrNew: null,
  bookingType: null,
  bookedTime: null,
  inspectionNeeded: false,
  urgency: null,
  safetyIssue: null,
  reason: null
};

function clean(value: string) {
  return value.replace(/[.?!,]+$/g, "").trim();
}

function detectName(text: string) {
  const match =
    text.match(/\b(?:my name is|this is|i am|i'm)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i) ??
    text.match(/^([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)$/i);
  if (!match) return null;
  return clean(match[1])
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function detectSuburb(text: string) {
  const match =
    text.match(/\b(?:in|at|near|around)\s+([a-z][a-z\s'-]{2,})$/i) ??
    text.match(/\bsuburb is\s+([a-z][a-z\s'-]{2,})/i);
  if (!match) return null;
  return clean(match[1])
    .split(" ")
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function detectAddress(text: string) {
  const match =
    text.match(/\b(?:address is|i'm at|im at|at)\s+(.+\b(?:street|st|road|rd|avenue|ave|drive|dr|parade|pde|place|pl|court|ct|lane|ln)\b.*)$/i) ??
    text.match(/\b(\d+[a-z]?\s+.+\b(?:street|st|road|rd|avenue|ave|drive|dr|parade|pde|place|pl|court|ct|lane|ln)\b.*)$/i);
  return match ? clean(match[1]) : null;
}

function detectSlot(text: string) {
  const slots = [...BOOKING_SLOTS.easy_job_slots, ...BOOKING_SLOTS.inspection_slots, ...BOOKING_SLOTS.urgent_slots];
  const lower = text.toLowerCase();
  return (
    slots.find((slot) => {
      const [day] = slot.toLowerCase().split(" ");
      return lower.includes(day) || lower.includes(slot.toLowerCase());
    }) ??
    (/\b(first|one|1)\b/.test(lower) ? slots[0] : null) ??
    (/\b(second|two|2)\b/.test(lower) ? slots[1] : null) ??
    (/\b(third|three|3)\b/.test(lower) ? slots[2] : null)
  );
}

export function fallbackFinalize(messages: TranscriptMessage[]) {
  const customerLines = messages.filter((message) => message.speaker === "customer").map((message) => message.text);
  const customerText = customerLines.join(" ");
  const draft: IntakeDraft = {
    ...blankBooking,
    customerName: customerLines.map(detectName).find(Boolean) ?? null,
    phone: CALLER_NUMBER,
    phoneConfirmed: /\b(yes|yeah|yep|correct|good|okay|ok|sure)\b/i.test(customerText),
    suburb: customerLines.map(detectSuburb).find(Boolean) ?? null,
    address: customerLines.map(detectAddress).find(Boolean) ?? null,
    bookedTime: detectSlot(customerText),
    reason: "Generated from the completed phone call."
  };

  draft.jobType =
    customerLines.find((line) => /(light|switch|power|fan|tripping|switchboard|install|replace|outdoor)/i.test(line)) ??
    null;
  return draft;
}
