import { NextRequest, NextResponse } from "next/server";
import { ConversationState } from "@/types";
import { getAvailableSlots, getAllDoctors } from "@/lib/doctorsDb";
import { dialSessionMap } from "@/app/api/voice/webhook/route";
import { formatDisplay } from "@/lib/dateUtils";

function formatSlotForVoice(s: { date: string; time: string }, i: number): string {
  return `${i + 1}. ${formatDisplay(s.date, s.time)}`;
}

export async function POST(req: NextRequest) {
  try {
    const { phoneNumber, state } = await req.json() as {
      phoneNumber: string;
      state: ConversationState;
    };

    // Always pre-load slots for all doctors so AI doesn't need to call any function
    const allDoctors = await getAllDoctors();
    const slotLines = await Promise.all(
      allDoctors.map(async (doc) => {
        const slots = await getAvailableSlots(doc.id, 3);
        const slotStr = slots.length > 0
          ? slots.map((s, i) => formatSlotForVoice(s, i)).join(", ")
          : "no slots available";
        return `${doc.specialty} - ${doc.name}: ${slotStr}`;
      })
    );
    const allSlotsFormatted = slotLines.join(" | ");

    // If doctor already matched, also get their next-3 slots for swapping
    const matchedSlots = state.matchedDoctor
      ? await getAvailableSlots(state.matchedDoctor.id, 6)
      : undefined;

    const p = state.patient;
    const missingFields: string[] = [];
    if (!p.email) missingFields.push("email address");
    if (!p.reason) missingFields.push("reason for visit");

    const contextSummary = [
      p.firstName && p.lastName ? `Name: ${p.firstName} ${p.lastName}` : null,
      p.dob ? `DOB: ${p.dob}` : null,
      p.phone ? `Phone: ${p.phone}` : null,
      p.email ? `Email: ${p.email}` : null,
      p.reason ? `Reason: ${p.reason}` : null,
      state.matchedDoctor ? `Matched doctor: ${state.matchedDoctor.name} (${state.matchedDoctor.specialty})` : null,
    ].filter(Boolean).join(", ");

    const openingMessage = missingFields.length > 0
      ? `Hello ${p.firstName ?? "there"}, this is an AI assistant calling from Kyron Medical. I'm continuing your appointment request. I still need to collect your ${missingFields.join(" and ")}. Let's get that done quickly.`
      : `Hello ${p.firstName}, this is an AI assistant calling from Kyron Medical. We've matched you with ${state.matchedDoctor?.name ?? "a specialist"} for your ${p.reason ?? "visit"} concern. I have some available appointment times for you.`;

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
        webhookUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/api/voice/webhook`,
        callAgentInput: {
          patientName: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
          specialties: "1. Bone & Joint Pain, 2. Heart & Chest, 3. Headache & Neurology, 4. Stomach & Digestion",
          context: contextSummary,
          missingFields: missingFields.join(", ") || "none",
          reason: p.reason ?? "",
          matchedDoctor: state.matchedDoctor?.name ?? "not yet determined",
          allSlots: allSlotsFormatted,
          slots: matchedSlots
            ? matchedSlots.slice(0, 3).map((s, i) => formatSlotForVoice(s, i)).join(", ")
            : "",
          slots2: matchedSlots && matchedSlots.length > 3
            ? matchedSlots.slice(3, 6).map((s, i) => formatSlotForVoice(s, i)).join(", ")
            : "no more slots available",
          sessionId: state.sessionId,
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

    // Map dialId -> sessionId for webhook lookup
    if (data.dialId) {
      dialSessionMap.set(data.dialId, state.sessionId);
    }

    return NextResponse.json({ dialId: data.dialId, sessionId: data.sessionId, success: true });
  } catch (error) {
    console.error("Voice error:", error);
    return NextResponse.json({ error: "Failed to initiate call" }, { status: 500 });
  }
}
