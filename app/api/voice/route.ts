import { NextRequest, NextResponse } from "next/server";
import { ConversationState } from "@/types";
import { getAvailableSlots, getAllDoctors } from "@/lib/doctorsDb";
import { formatDisplay } from "@/lib/dateUtils";
import { prisma } from "@/lib/db";

type VoiceState = ConversationState & {
  refillDoctor?: string;
  refillMedication?: string;
};

function formatSlotForVoice(s: { date: string; time: string }, i: number): string {
  return `${i + 1}. ${formatDisplay(s.date, s.time)}`;
}

function isRefillFlow(state: VoiceState): boolean {
  return state.step?.startsWith("refill_") || Boolean(state.refillDoctor || state.refillMedication);
}

function getRefillMissingFields(state: VoiceState): string[] {
  const p = state.patient ?? {};
  const missingFields: string[] = [];
  if (!p.firstName || !p.lastName) missingFields.push("full name");
  if (!p.phone) missingFields.push("phone number");
  if (!state.refillDoctor) missingFields.push("prescribing doctor");
  if (!state.refillMedication) missingFields.push("medication name");
  return missingFields;
}

function getAppointmentMissingFields(state: VoiceState): string[] {
  const p = state.patient ?? {};
  const missingFields: string[] = [];
  if (!p.firstName || !p.lastName) missingFields.push("full name");
  if (!p.dob) missingFields.push("date of birth");
  if (!p.phone) missingFields.push("phone number");
  if (!p.email) missingFields.push("email address");
  if (!p.reason) missingFields.push("reason for visit");
  return missingFields;
}

export async function POST(req: NextRequest) {
  try {
    const { phoneNumber, state } = await req.json() as {
      phoneNumber: string;
      state: VoiceState;
    };

    const sessionId = state.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const existingSession = await prisma.session.findUnique({ where: { id: sessionId } });
    const existingContext = (existingSession?.context as unknown as Partial<VoiceState>) ?? {};
    const mergedState: VoiceState = {
      ...existingContext,
      ...state,
      patient: {
        ...(existingContext.patient ?? {}),
        ...(state.patient ?? {}),
      },
      refillDoctor: state.refillDoctor ?? existingContext.refillDoctor,
      refillMedication: state.refillMedication ?? existingContext.refillMedication,
      sessionId,
      step: state.step ?? existingContext.step ?? "greeting",
    } as VoiceState;

    await prisma.session.upsert({
      where: { id: sessionId },
      update: { step: mergedState.step ?? "greeting", context: mergedState as unknown as object, updatedAt: new Date() },
      create: { id: sessionId, step: mergedState.step ?? "greeting", context: mergedState as unknown as object },
    });

    const p = mergedState?.patient ?? { firstName: "", lastName: "", dob: "", phone: "", email: "", reason: "" };
    const refillFlow = isRefillFlow(mergedState);
    const missingFields = refillFlow ? getRefillMissingFields(mergedState) : getAppointmentMissingFields(mergedState);

    const allSlotsFormatted = refillFlow ? "" : await getAllSlotsFormatted();
    const matchedSlots = !refillFlow && mergedState.matchedDoctor
      ? await getAvailableSlots(mergedState.matchedDoctor.id, 6)
      : undefined;

    const contextSummary = [
      p.firstName && p.lastName ? `Name: ${p.firstName} ${p.lastName}` : null,
      p.dob ? `DOB: ${p.dob}` : null,
      p.phone ? `Phone: ${p.phone}` : null,
      p.email ? `Email: ${p.email}` : null,
      !refillFlow && p.reason ? `Reason: ${p.reason}` : null,
      refillFlow ? "Request type: prescription refill" : null,
      refillFlow && mergedState.refillDoctor ? `Prescribing doctor: ${mergedState.refillDoctor}` : null,
      refillFlow && mergedState.refillMedication ? `Medication: ${mergedState.refillMedication}` : null,
      mergedState.matchedDoctor ? `Matched doctor: ${mergedState.matchedDoctor.name} (${mergedState.matchedDoctor.specialty})` : null,
    ].filter(Boolean).join(", ");

    const hasContext = !!(p.firstName || p.reason || p.email || refillFlow);
    const openingMessage = refillFlow
      ? missingFields.length > 0
        ? `Hello ${p.firstName ?? "there"}, this is Kyra calling from Kyron Medical about your prescription refill request. I already have ${contextSummary || "some details"} from chat. I only need your ${missingFields.join(" and ")}.`
        : `Hello ${p.firstName ?? "there"}, this is Kyra calling from Kyron Medical about your prescription refill request. I have the details we need and will submit it to the care team.`
      : !hasContext
        ? `Hello, this is Kyra calling from Kyron Medical. How can I help you today? I can assist with: scheduling an appointment, checking next available times, prescription refills, or office hours and location.`
        : missingFields.length > 0
          ? `Hello ${p.firstName ?? "there"}, this is Kyra calling from Kyron Medical. I'm following up on your request. I still need to collect your ${missingFields.join(" and ")}. Let's get that done quickly.`
          : `Hello ${p.firstName}, this is Kyra calling from Kyron Medical. We've matched you with ${mergedState.matchedDoctor?.name ?? "a specialist"} for your ${p.reason ?? "visit"} concern. I have some available appointment times for you.`;

    const vogentResponse = await fetch("https://api.vogent.ai/api/dials", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VOGENT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        callAgentId: process.env.VOGENT_AGENT_ID,
        toNumber: phoneNumber,
        fromNumberId: process.env.VOGENT_FROM_NUMBER_ID,
        webhookUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? req.nextUrl.origin}/api/voice/webhook?sessionId=${sessionId}`,
        callAgentInput: {
          patientName: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
          specialties: refillFlow ? "" : "1. Bone & Joint Pain, 2. Heart & Chest, 3. Headache & Neurology, 4. Stomach & Digestion",
          context: contextSummary,
          missingFields: missingFields.join(", ") || "none",
          flow: refillFlow ? "prescription_refill" : "appointment",
          taskInstructions: refillFlow
            ? "This call is ONLY for a prescription refill. Do not ask for a reason for visit, appointment reason, specialties, or appointment slots. Use the chat context already provided. Ask only for missing refill details in this order: full name, phone number, prescribing doctor, medication name. Once those are collected, say the refill request will be sent to the care team."
            : "This call can handle appointment scheduling, checking next available times, office hours, or location. If the patient asks for next available times, read the earliest available appointment for EACH doctor from allSlots, then ask if there is anything else you can help with. Do not ask for name, DOB, phone, email, or reason for the next-available flow. For appointment scheduling, collect missing appointment details, match specialty, offer slots, and confirm a selected appointment.",
          reason: refillFlow ? "" : p.reason ?? "",
          refillDoctor: mergedState.refillDoctor ?? "",
          refillMedication: mergedState.refillMedication ?? "",
          matchedDoctor: mergedState.matchedDoctor?.name ?? "not yet determined",
          allSlots: allSlotsFormatted,
          slots: matchedSlots
            ? matchedSlots.slice(0, 3).map((s, i) => formatSlotForVoice(s, i)).join(", ")
            : "",
          slots2: matchedSlots && matchedSlots.length > 3
            ? matchedSlots.slice(3, 6).map((s, i) => formatSlotForVoice(s, i)).join(", ")
            : "no more slots available",
          sessionId,
        },
        agentOverrides: {
          openingLine: {
            lineType: "INBOUND_OUTBOUND",
            content: openingMessage,
          },
        },
      }),
    });

    if (!vogentResponse.ok) {
      const err = await vogentResponse.text();
      console.error("Vogent error:", err);
      return NextResponse.json({ error: "Failed to initiate call" }, { status: 500 });
    }

    const data = await vogentResponse.json();

    return NextResponse.json({ dialId: data.dialId, sessionId: data.sessionId, success: true });
  } catch (error) {
    console.error("Voice error:", error);
    return NextResponse.json({ error: "Failed to initiate call" }, { status: 500 });
  }
}

async function getAllSlotsFormatted(): Promise<string> {
  const allDoctors = await getAllDoctors();
  const slotLines = await Promise.all(
    allDoctors.map(async (doc) => {
      const slots = await getAvailableSlots(doc.id, 1);
      const slotStr = slots.length > 0
        ? formatDisplay(slots[0].date, slots[0].time)
        : "no slots available";
      return `${doc.name} (${doc.specialty}): ${slotStr}`;
    })
  );
  return `Earliest available appointment for each doctor: ${slotLines.join(" | ")}`;
}
