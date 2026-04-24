import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai/router";
import { buildSystemPrompt } from "@/lib/prompts";
import { matchDoctorByReason, getAvailableSlots, checkSlotAvailable } from "@/lib/doctorsDb";
import { ConversationState, AIModel, Message } from "@/types";
import { prisma } from "@/lib/db";

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


    // For intake steps, use hardcoded replies instead of AI
    const hardcodedReply = getHardcodedReply(state);
    let reply: string;

    if (hardcodedReply) {
      reply = hardcodedReply;
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
    const allFetched = state.matchedDoctor ? await getAvailableSlots(state.matchedDoctor.id, slotOff + 3) : undefined;
    const availableSlots = allFetched ? allFetched.slice(slotOff) : undefined;

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
    case "greeting":
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
        state.step = "collect_reason";
      }
      break;
    }

    case "collect_reason":
    case "match_doctor": {
      state.patient.reason = message;
      const doctor = await matchDoctorByReason(message);
      if (doctor) {
        state.matchedDoctor = doctor;
        state.step = "show_slots";
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
        const offset = (state.slotOffset ?? 0) + 3;
        const nextSlots = await getAvailableSlots(state.matchedDoctor.id, offset + 3);
        if (nextSlots.length > (state.slotOffset ?? 0) + 3) {
          state.slotOffset = offset;
        } else {
          // No more slots — ask for preferred time
          state.step = "request_preferred_time";
          state.slotOffset = 0;
        }
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

function getHardcodedReply(state: ConversationState): string | null {
  const { step, patient } = state;

  switch (step) {
    case "collect_name":
      return "Could you please tell me your full name (first and last)?";
    case "collect_dob":
      return `Thank you, ${patient.firstName}! Could you please provide your date of birth? (e.g. 01/15/1990)`;
    case "collect_phone":
      return "Got it! What's the best phone number to reach you?";
    case "collect_email":
      return "Great! And what's your email address?";
    case "collect_reason":
      return "Thank you! Could you briefly describe the reason for your visit today?";
    case "match_doctor":
      return "I'm sorry, our practice doesn't currently treat that condition. Is there anything else I can help you with?";
    case "request_preferred_time":
      if ((state as any).preferredTimeNotFound) {
        (state as any).preferredTimeNotFound = false;
        return "I'm sorry, we don't have availability at that exact time. Could you suggest another date or time that works for you?";
      }
      return "What date and time would work best for you? (e.g. June 10 at 2:00 PM)";
    default:
      return null; // use AI for show_slots, confirm_booking, booked, general
  }
}
