import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai/router";
import { buildSystemPrompt } from "@/lib/prompts";
import { matchDoctorByReason, getAvailableSlots, checkSlotAvailable } from "@/lib/doctorsDb";
import { ConversationState, AIModel, Message } from "@/types";
import { prisma } from "@/lib/db";
import { PRACTICE_INFO } from "@/lib/doctors";

const sessions = new Map<string, ConversationState>();

export async function POST(req: NextRequest) {
  try {
    const { message, sessionId, model = "claude", history = [], smsConsent } = await req.json() as {
      message: string;
      sessionId: string;
      model: AIModel;
      history: Message[];
      smsConsent?: boolean;
    };

    let state: ConversationState = sessions.get(sessionId) ?? null!;

    if (!state) {
      const dbSession = await prisma.session.findUnique({ where: { id: sessionId } });
      if (dbSession) {
        state = dbSession.context as unknown as ConversationState;
      } else {
        state = { step: "greeting", patient: {}, sessionId };
      }
    }

    state = await updateState(state, message);

    let reply: string;

    if (state.step === "next_available") {
      const { getAllDoctors } = await import("@/lib/doctorsDb");
      const allDoctors = await getAllDoctors();
      const lines = await Promise.all(
        allDoctors.map(async (doc) => {
          const slots = await getAvailableSlots(doc.id, 1);
          if (slots.length === 0) return null;
          const { formatDisplay } = await import("@/lib/dateUtils");
          return `**${formatDisplay(slots[0].date, slots[0].time)}** with ${doc.name} (${doc.specialty})`;
        })
      );
      const available = lines.filter(Boolean);
      reply = available.length > 0
        ? `Here are the soonest openings we have:\n\n${available.join("\n\n")}\n\nWhich one works for you, or is there a particular specialty you need? Is there anything else I can help you with?`
        : "I'm sorry, there are no available slots at the moment. Please call us at " + PRACTICE_INFO.phone + " to check availability. Is there anything else I can help you with?";
      state.step = "general";
    } else if (state.step === "office_info") {
      reply = `Here's our practice information:\n\n📍 **Address:** ${PRACTICE_INFO.address}\n📞 **Phone:** ${PRACTICE_INFO.phone}\n🕐 **Hours:** ${PRACTICE_INFO.hours}\n\nIs there anything else I can help you with?`;
    } else {
      const aiMessages = history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      aiMessages.push({ role: "user", content: message });
      const offset = state.slotOffset ?? 0;
      const slots = state.matchedDoctor ? await getAvailableSlots(state.matchedDoctor.id, offset + 3) : undefined;
      const visibleSlots = slots ? slots.slice(offset) : undefined;
      const systemPrompt = buildSystemPrompt(state, visibleSlots);
      reply = await callAI(model, aiMessages, systemPrompt);
    }

    if (smsConsent !== undefined) (state.patient as any).smsConsent = smsConsent;
    sessions.set(sessionId, state);

    // Persist session to DB
    await prisma.session.upsert({
      where: { id: sessionId },
      update: { step: state.step, context: state as any, updatedAt: new Date() },
      create: { id: sessionId, step: state.step, context: state as any },
    });

    const slotOff = state.slotOffset ?? 0;
    const isPreferredStep = state.step === "request_preferred_time";
    const allFetched = state.matchedDoctor
      ? await getAvailableSlots(state.matchedDoctor.id, isPreferredStep ? 60 : slotOff + 3)
      : undefined;
    const availableSlots = allFetched ? (isPreferredStep ? allFetched : allFetched.slice(slotOff)) : undefined;

    return NextResponse.json({
      reply,
      state: {
        step: state.step,
        matchedDoctor: state.matchedDoctor,
        availableSlots,
        selectedSlot: state.selectedSlot,
        patient: state.patient,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Failed to process message", detail: String(error) }, { status: 500 });
  }
}

async function updateState(state: ConversationState, message: string): Promise<ConversationState> {
  const lower = message.toLowerCase().trim();

  switch (state.step) {
    case "greeting": {
      if (/refill|prescription/i.test(lower)) {
        state.step = "refill_collect_name";
      } else if (/next available|soonest|earliest|first opening/i.test(lower)) {
        state.step = "next_available";
      } else if (/office|hour|location|address|where|direction|open|clos|weekend/i.test(lower)) {
        state.step = "office_info";
      } else {
        state.step = "collect_reason";
      }
      break;
    }

    case "collect_name": {
      const parts = message.trim().split(/\s+/);
      if (parts.length >= 2) {
        state.patient.firstName = parts[0];
        state.patient.lastName = parts.slice(1).join(" ");
        state.step = "collect_dob";
      } else {
        state.step = "collect_name";
      }
      break;
    }

    case "collect_dob": {
      const dobMatch = message.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
      if (dobMatch) {
        state.patient.dob = dobMatch[0];
        state.step = "collect_phone";
      }
      break;
    }

    case "collect_phone": {
      const phoneMatch = message.replace(/\D/g, "");
      if (phoneMatch.length >= 10) {
        state.patient.phone = phoneMatch;
        state.step = "collect_email";
      }
      break;
    }

    case "collect_email": {
      const emailMatch = message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      if (emailMatch) {
        state.patient.email = emailMatch[0];
        // If reason already collected (specialty asked first), go straight to slots
        state.step = state.matchedDoctor ? "show_slots" : "collect_reason";
      }
      break;
    }

    case "collect_reason":
    case "match_doctor": {
      state.patient.reason = message;
      const doctor = await matchDoctorByReason(message);
      if (doctor) {
        state.matchedDoctor = doctor;
        // If patient info already collected, go to slots; otherwise collect name first
        state.step = (state.patient.firstName && state.patient.lastName) ? "show_slots" : "collect_name";
      } else {
        state.step = "match_doctor";
      }
      break;
    }

    case "show_slots": {
      const slotIndex = parseInt(lower) - 1;
      const wantsMore = /more|another|different|other|next|else/i.test(lower);

      if (!isNaN(slotIndex) && state.matchedDoctor) {
        const offset = state.slotOffset ?? 0;
        const slots = await getAvailableSlots(state.matchedDoctor.id, offset + 3);
        const visibleSlots = slots.slice(offset);
        if (visibleSlots[slotIndex]) {
          state.selectedSlot = visibleSlots[slotIndex];
          state.step = "confirm_booking";
        }
      } else if (wantsMore && state.matchedDoctor) {
        state.step = "request_preferred_time";
        state.slotOffset = 0;
      }
      break;
    }

    case "request_preferred_time": {
      const parsed = parseDateTimeFromMessage(message);
      if (parsed && state.matchedDoctor) {
        const slot = await checkSlotAvailable(state.matchedDoctor.id, parsed.date, parsed.time);
        if (slot) {
          state.selectedSlot = slot;
          state.step = "confirm_booking";
        } else {
          (state as any).preferredTimeRequest = message;
          (state as any).preferredTimeNotFound = true;
        }
      }
      break;
    }

    case "check_preferred_slot": {
      if (lower.includes("yes") || lower.includes("confirm") || lower.includes("book")) {
        state.step = "booked";
      } else if (lower.includes("no") || lower.includes("change")) {
        state.step = "request_preferred_time";
      }
      break;
    }

    case "confirm_booking": {
      if (lower.includes("yes") || lower.includes("confirm") || lower.includes("book")) {
        state.step = "booked";
      } else if (lower.includes("no") || lower.includes("change")) {
        state.step = "show_slots";
      }
      break;
    }

    case "refill_collect_name": {
      const parts = message.trim().split(/\s+/);
      if (parts.length >= 2) {
        state.patient.firstName = parts[0];
        state.patient.lastName = parts.slice(1).join(" ");
        state.step = "refill_collect_phone";
      }
      break;
    }

    case "refill_collect_phone": {
      const digits = message.replace(/\D/g, "");
      if (digits.length >= 10) {
        state.patient.phone = digits;
        state.step = "refill_collect_doctor";
      }
      break;
    }

    case "refill_collect_doctor": {
      if (message.trim().length > 2) {
        (state as any).refillDoctor = message.trim();
        state.step = "refill_collect_medication";
      }
      break;
    }

    case "refill_collect_medication": {
      (state as any).refillMedication = message.trim();
      state.step = "refill_submitted";
      // Fire-and-forget: notify the practice
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient: state.patient,
          doctor: {},
          slot: {},
          type: "prescription_refill",
          preferredTime: message.trim(),
        }),
      }).catch(() => {});
      break;
    }

    case "booked":
    case "office_info":
    case "refill_submitted":
    case "general": {
      // User wants to start a new flow after a completed one
      if (/refill|prescription/i.test(lower)) {
        state.step = "refill_collect_name";
      } else if (/next available|soonest|earliest/i.test(lower)) {
        state.step = "next_available";
      } else if (/office|hour|location|address|where|open|clos/i.test(lower)) {
        state.step = "office_info";
      } else if (/appointment|schedule|book|see a doctor|visit/i.test(lower)) {
        // Reset booking-related state and restart appointment flow
        state.matchedDoctor = undefined;
        state.selectedSlot = undefined;
        state.slotOffset = 0;
        state.patient.reason = undefined;
        // Skip re-collecting info we already have
        const p = state.patient;
        state.step = (p.firstName && p.lastName && p.dob && p.phone && p.email)
          ? "collect_reason"
          : "collect_name";
      } else {
        state.step = "general";
      }
      break;
    }

    default:
      break;
  }

  return { ...state };
}

function parseDateTimeFromMessage(message: string): { date: string; time: string } | null {
  const timeMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1]);
  const minutes = parseInt(timeMatch[2] ?? "0");
  const meridiem = timeMatch[3].toLowerCase();
  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  const cleaned = message
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/gi, "")
    .replace(/\s+at\s+\d.*$/i, "")
    .trim();
  const dateAttempt = new Date(cleaned);
  if (!isNaN(dateAttempt.getTime())) {
    const dateStr = dateAttempt.toISOString().split("T")[0];
    return { date: dateStr, time: timeStr };
  }
  return null;
}
