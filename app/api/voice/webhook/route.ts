import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { matchDoctorByReason } from "@/lib/doctorsDb";
import { AvailabilitySlot, ConversationStep, Doctor, PatientInfo } from "@/types";

type ExtractedPatientInfo = {
  email?: string;
  reason?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  refillMedication?: string;
  refillDoctor?: string;
};

type VoiceTranscriptLine = { text: string; speaker: string };

type VoiceContext = {
  patient?: Partial<PatientInfo>;
  matchedDoctor?: Doctor;
  selectedSlot?: AvailabilitySlot;
  step?: ConversationStep;
  bookingConfirmed?: boolean;
  preferredTimeRequest?: { date: string; time: string; rawTime?: string };
  preferredTimeHandled?: boolean;
  refillMedication?: string;
  refillDoctor?: string;
  refillNotified?: boolean;
  voiceTranscript?: VoiceTranscriptLine[];
};

type WebhookPayload = {
  ai_result?: {
    appointmentBooked?: boolean;
    preferredDate?: string;
    preferredTime?: string;
    selectedDate?: string;
    selectedTime?: string;
  };
  transcript?: VoiceTranscriptLine[];
};

function asJsonContext(context: VoiceContext): object {
  return context as unknown as object;
}

async function extractPatientInfoFromTranscript(
  transcript: VoiceTranscriptLine[]
): Promise<ExtractedPatientInfo | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const text = transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 384,
    messages: [{
      role: "user",
      content: `Extract patient info from this voice call transcript. Reply with ONLY valid JSON.

Transcript:
${text}

Reply format: {"email": "extracted email or empty string", "reason": "reason for visit or empty string", "firstName": "first name or empty string", "lastName": "last name or empty string", "phone": "10 digit phone or empty string", "refillMedication": "medication requested for refill or empty string", "refillDoctor": "prescribing doctor or empty string"}

Rules:
- email: extract the email address the patient spelled out (e.g. "j-o-h-n at gmail dot com" = "john@gmail.com")
- reason: the medical reason/symptom they mentioned
- refillMedication: only fill this if the patient is asking for a prescription refill
- phone: digits only
- Use empty string if not found`
    }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

function normalizeDate(rawDate: string): string {
  if (!rawDate) return rawDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;

  const cleaned = rawDate
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/gi, "")
    .trim();
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return rawDate;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTime(rawTime: string): string {
  if (!rawTime) return rawTime;
  if (/^\d{2}:\d{2}$/.test(rawTime)) return rawTime;

  const match = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return rawTime;

  let hours = parseInt(match[1]);
  const mins = match[2] ?? "00";
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${mins}`;
}

async function getAvailableSlotsForContext(context: VoiceContext) {
  if (!context.matchedDoctor?.id) return [];
  return prisma.slot.findMany({
    where: { doctorId: context.matchedDoctor.id, available: true },
    orderBy: [{ date: "asc" }, { time: "asc" }],
    take: 6,
    select: { date: true, time: true },
  });
}

async function handlePreferredTime(
  baseUrl: string,
  sessionId: string,
  context: VoiceContext,
  preferredDate: string,
  preferredTime: string
): Promise<VoiceContext> {
  const normalizedDate = normalizeDate(preferredDate);
  const normalizedTime = normalizeTime(preferredTime);

  context.preferredTimeRequest = {
    date: normalizedDate,
    time: normalizedTime,
    rawTime: preferredTime,
  };

  if (!context.patient?.email) {
    await prisma.session.update({ where: { id: sessionId }, data: { context: asJsonContext(context) } });
    console.log("Preferred time saved; waiting for transcript email");
    return context;
  }

  if (context.preferredTimeHandled) return context;

  const prefSlot = await prisma.slot.findFirst({
    where: {
      date: normalizedDate,
      time: normalizedTime,
      available: true,
      ...(context.matchedDoctor?.id ? { doctorId: context.matchedDoctor.id } : {}),
    },
    include: { doctor: true },
  });

  if (prefSlot) {
    const doctor = {
      id: prefSlot.doctor.id,
      name: prefSlot.doctor.name,
      specialty: prefSlot.doctor.specialty,
      bodyParts: prefSlot.doctor.bodyParts,
      bio: prefSlot.doctor.bio,
      availability: [],
    };
    const bookRes = await fetch(`${baseUrl}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient: context.patient,
        doctor,
        slot: { date: normalizedDate, time: normalizedTime, available: true },
        reason: context.patient?.reason ?? "",
      }),
    }).catch((error) => {
      console.error("Preferred booking request failed:", error);
      return null;
    });

    if (bookRes?.ok) {
      context.step = "booked";
      context.selectedSlot = { date: normalizedDate, time: normalizedTime, available: true };
      context.matchedDoctor = doctor;
      context.bookingConfirmed = true;
      context.preferredTimeHandled = true;
      await prisma.session.update({ where: { id: sessionId }, data: { step: "booked", context: asJsonContext(context) } });
      console.log("Preferred slot booked for:", context.patient.email);
      return context;
    }

    console.error("Preferred slot booking failed:", await bookRes?.text().catch(() => ""));
  }

  const availableSlots = await getAvailableSlotsForContext(context);
  const notifyRes = await fetch(`${baseUrl}/api/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient: context.patient,
      doctor: context.matchedDoctor ?? {},
      slot: {},
      type: "slot_unavailable",
      preferredTime: `${normalizedDate} at ${preferredTime}`,
      availableSlots,
    }),
  }).catch((error) => {
    console.error("Preferred unavailable notification failed:", error);
    return null;
  });

  if (notifyRes?.ok) {
    context.preferredTimeHandled = true;
    await prisma.session.update({ where: { id: sessionId }, data: { context: asJsonContext(context) } });
    console.log("Unavailable slot notified for:", context.patient.email);
  } else {
    console.error("Preferred unavailable notification was not sent:", await notifyRes?.text().catch(() => ""));
  }

  return context;
}

async function handleRefillRequest(baseUrl: string, sessionId: string, context: VoiceContext): Promise<VoiceContext> {
  if (!context.refillMedication || context.refillNotified) return context;

  const notifyRes = await fetch(`${baseUrl}/api/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient: context.patient ?? {},
      doctor: {},
      slot: {},
      type: "prescription_refill",
      preferredTime: context.refillMedication,
    }),
  }).catch((error) => {
    console.error("Voice refill notification failed:", error);
    return null;
  });

  if (notifyRes?.ok) {
    context.step = "refill_submitted";
    context.refillNotified = true;
    await prisma.session.update({ where: { id: sessionId }, data: { step: "refill_submitted", context: asJsonContext(context) } });
    console.log("Voice refill notification sent for:", context.patient?.phone ?? context.patient?.email ?? "unknown patient");
  } else {
    console.error("Voice refill notification was not sent:", await notifyRes?.text().catch(() => ""));
  }

  return context;
}

export async function POST(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    const body = await req.json() as { event?: string; payload?: WebhookPayload };
    const { event, payload } = body;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? req.nextUrl.origin;

    console.log("Vogent webhook:", event, JSON.stringify(payload, null, 2));

    if (!sessionId) return NextResponse.json({ ok: true });

    const dbSession = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!dbSession) return NextResponse.json({ ok: true });

    const context = ((dbSession.context as unknown) ?? {}) as VoiceContext;

    if (event === "dial.extractor") {
      const ai_result = payload?.ai_result;

      if (!ai_result?.appointmentBooked && ai_result?.preferredDate && ai_result?.preferredTime) {
        await handlePreferredTime(baseUrl, sessionId, context, ai_result.preferredDate, ai_result.preferredTime);
      }

      if (ai_result?.appointmentBooked && ai_result.selectedDate && ai_result.selectedTime) {
        const normalizedDate = normalizeDate(ai_result.selectedDate);
        const normalizedTime = normalizeTime(ai_result.selectedTime);
        context.selectedSlot = { date: normalizedDate, time: normalizedTime, available: true };
        context.step = "booked";

        if (!context.matchedDoctor) {
          const slot = await prisma.slot.findFirst({
            where: { date: normalizedDate, time: normalizedTime },
            include: { doctor: true },
          });
          if (slot?.doctor) {
            context.matchedDoctor = {
              id: slot.doctor.id,
              name: slot.doctor.name,
              specialty: slot.doctor.specialty,
              bodyParts: slot.doctor.bodyParts,
              bio: slot.doctor.bio,
              availability: [],
            };
          }
        }

        await prisma.session.update({ where: { id: sessionId }, data: { step: "booked", context: asJsonContext(context) } });

        const freshForEmail = await prisma.session.findUnique({ where: { id: sessionId } });
        const emailCtx = ((freshForEmail?.context as unknown) ?? context) as VoiceContext;
        if (!emailCtx.patient?.email) {
          await handlePreferredTime(baseUrl, sessionId, emailCtx, normalizedDate, ai_result.selectedTime);
          console.log("No email yet, selected time saved for transcript retry");
        } else if (emailCtx.matchedDoctor && emailCtx.selectedSlot && !emailCtx.bookingConfirmed) {
          const bookRes = await fetch(`${baseUrl}/api/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patient: emailCtx.patient,
              doctor: emailCtx.matchedDoctor,
              slot: emailCtx.selectedSlot,
              reason: emailCtx.patient?.reason ?? "",
            }),
          }).catch((error) => {
            console.error("Booking request failed from extractor:", error);
            return null;
          });
          if (bookRes?.ok) {
            emailCtx.bookingConfirmed = true;
            await prisma.session.update({ where: { id: sessionId }, data: { context: asJsonContext(emailCtx) } });
            console.log("Booking + notifications sent (from extractor) to:", emailCtx.patient.email);
          } else if (bookRes?.status === 409) {
            await handlePreferredTime(baseUrl, sessionId, emailCtx, normalizedDate, ai_result.selectedTime);
          } else {
            console.error("Booking from extractor failed:", await bookRes?.text().catch(() => ""));
          }
        } else {
          console.log("No email yet, dial.transcript will send it");
        }
      }
    }

    if (event === "dial.transcript") {
      const transcript = payload?.transcript ?? [];
      context.voiceTranscript = transcript;

      const extracted = await extractPatientInfoFromTranscript(transcript).catch((error) => {
        console.error("Transcript extraction failed:", error);
        return null;
      });
      console.log("Extracted patient info:", extracted);

      if (extracted?.email && !context.patient?.email) context.patient = { ...context.patient, email: extracted.email };
      if (extracted?.firstName && !context.patient?.firstName) context.patient = { ...context.patient, firstName: extracted.firstName };
      if (extracted?.lastName && !context.patient?.lastName) context.patient = { ...context.patient, lastName: extracted.lastName };
      if (extracted?.phone && !context.patient?.phone) context.patient = { ...context.patient, phone: extracted.phone.replace(/\D/g, "") };
      if (extracted?.reason && !context.patient?.reason) context.patient = { ...context.patient, reason: extracted.reason };
      if (extracted?.refillMedication) context.refillMedication = extracted.refillMedication;
      if (extracted?.refillDoctor) context.refillDoctor = extracted.refillDoctor;

      if (!context.matchedDoctor && context.patient?.reason) {
        const doctor = await matchDoctorByReason(context.patient.reason).catch(() => null);
        if (doctor) context.matchedDoctor = doctor;
      }

      await prisma.session.update({ where: { id: sessionId }, data: { context: asJsonContext(context) } });

      const fresh = await prisma.session.findUnique({ where: { id: sessionId } });
      const freshCtx = ((fresh?.context as unknown) ?? context) as VoiceContext;

      if (context.patient?.email) freshCtx.patient = { ...freshCtx.patient, email: context.patient.email };
      if (context.patient?.firstName) freshCtx.patient = { ...freshCtx.patient, firstName: context.patient.firstName };
      if (context.patient?.lastName) freshCtx.patient = { ...freshCtx.patient, lastName: context.patient.lastName };
      if (context.patient?.phone) freshCtx.patient = { ...freshCtx.patient, phone: context.patient.phone };
      if (context.matchedDoctor) freshCtx.matchedDoctor = context.matchedDoctor;
      if (context.refillMedication) freshCtx.refillMedication = context.refillMedication;
      if (context.refillDoctor) freshCtx.refillDoctor = context.refillDoctor;

      if (freshCtx.preferredTimeRequest && !freshCtx.preferredTimeHandled) {
        await handlePreferredTime(
          baseUrl,
          sessionId,
          freshCtx,
          freshCtx.preferredTimeRequest.date,
          freshCtx.preferredTimeRequest.rawTime ?? freshCtx.preferredTimeRequest.time
        );
      }

      if (freshCtx.step === "booked" && freshCtx.patient?.email && freshCtx.matchedDoctor && freshCtx.selectedSlot && !freshCtx.bookingConfirmed) {
        const bookRes = await fetch(`${baseUrl}/api/book`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient: freshCtx.patient,
            doctor: freshCtx.matchedDoctor,
            slot: freshCtx.selectedSlot,
            reason: freshCtx.patient?.reason ?? "",
          }),
        }).catch((error) => {
          console.error("Booking request failed from transcript:", error);
          return null;
        });
        if (bookRes?.ok) {
          freshCtx.bookingConfirmed = true;
          await prisma.session.update({ where: { id: sessionId }, data: { context: asJsonContext(freshCtx) } });
          console.log("Booking triggered from transcript for:", freshCtx.patient.email);
        } else if (bookRes?.status === 409) {
          await handlePreferredTime(
            baseUrl,
            sessionId,
            freshCtx,
            freshCtx.selectedSlot.date,
            freshCtx.selectedSlot.time
          );
        } else {
          console.error("Booking from transcript failed:", await bookRes?.text().catch(() => ""));
        }
      }

      await handleRefillRequest(baseUrl, sessionId, freshCtx);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
