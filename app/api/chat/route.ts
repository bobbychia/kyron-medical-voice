import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai/router";
import { buildSystemPrompt } from "@/lib/prompts";
import { matchDoctorByReason, getAvailableSlots } from "@/lib/doctorsDb";
import { ConversationState, AIModel, Message } from "@/types";
import { prisma } from "@/lib/db";

const sessions = new Map<string, ConversationState>();

export async function POST(req: NextRequest) {
  try {
    const { message, sessionId, model = "claude", history = [] } = await req.json() as {
      message: string;
      sessionId: string;
      model: AIModel;
      history: Message[];
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
      const slots = state.matchedDoctor ? await getAvailableSlots(state.matchedDoctor.id) : undefined;
      const systemPrompt = buildSystemPrompt(state, slots);
      reply = await callAI(model, aiMessages, systemPrompt);
    }

    sessions.set(sessionId, state);

    // Persist session to DB
    await prisma.session.upsert({
      where: { id: sessionId },
      update: { step: state.step, context: state as any, updatedAt: new Date() },
      create: { id: sessionId, step: state.step, context: state as any },
    });

    const availableSlots = state.matchedDoctor
      ? await getAvailableSlots(state.matchedDoctor.id)
      : undefined;

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
      if (!isNaN(slotIndex) && state.matchedDoctor) {
        const slots = await getAvailableSlots(state.matchedDoctor.id);
        if (slots[slotIndex]) {
          state.selectedSlot = slots[slotIndex];
          state.step = "confirm_booking";
        }
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
    default:
      return null; // use AI for show_slots, confirm_booking, booked, general
  }
}
