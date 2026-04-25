import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { matchDoctorByReason } from "@/lib/doctorsDb";

export const dialSessionMap = new Map<string, string>();

async function extractPatientInfoFromTranscript(
  transcript: { text: string; speaker: string }[]
): Promise<{ email?: string; reason?: string } | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const text = transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: `Extract patient info from this voice call transcript. Reply with ONLY valid JSON.

Transcript:
${text}

Reply format: {"email": "extracted email or empty string", "reason": "reason for visit or empty string"}

Rules:
- email: extract the email address the patient spelled out (e.g. "j-o-h-n at gmail dot com" = "john@gmail.com")
- reason: the medical reason/symptom they mentioned
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
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  // Remove weekday prefix (e.g. "Saturday, June 6 2026" → "June 6 2026")
  const cleaned = rawDate.replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/gi, "").trim();
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return rawDate;
}

function normalizeTime(rawTime: string): string {
  const match = rawTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return rawTime;
  let hours = parseInt(match[1]);
  const mins = match[2];
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${mins}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event, payload } = body;

    console.log("Vogent webhook:", event, JSON.stringify(payload, null, 2));

    // dial.extractor: save slot info and book the slot only (no email)
    if (event === "dial.extractor") {
      const { dial_id, ai_result } = payload;
      const sessionId = dialSessionMap.get(dial_id);
      if (!sessionId) return NextResponse.json({ ok: true });

      const dbSession = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!dbSession) return NextResponse.json({ ok: true });

      const context = (dbSession.context as any) ?? {};

      // Patient gave a preferred time but it wasn't in offered slots
      if (!ai_result?.appointmentBooked && ai_result?.preferredDate && ai_result?.preferredTime) {
        const normalizedPrefDate = normalizeDate(ai_result.preferredDate);
        const normalizedPref = normalizeTime(ai_result.preferredTime);
        const prefSlot = await prisma.slot.findFirst({
          where: { date: normalizedPrefDate, time: normalizedPref, available: true },
          include: { doctor: true },
        });

        const freshForPref = await prisma.session.findUnique({ where: { id: sessionId } });
        const prefCtx = (freshForPref?.context as any) ?? context;

        if (prefSlot && prefCtx.patient?.email) {
          // Slot exists — book it
          const doctor = {
            id: prefSlot.doctor.id, name: prefSlot.doctor.name,
            specialty: prefSlot.doctor.specialty, bodyParts: prefSlot.doctor.bodyParts,
            bio: prefSlot.doctor.bio, availability: [],
          };
          await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patient: prefCtx.patient, doctor,
              slot: { date: normalizedPrefDate, time: normalizedPref, available: true },
              reason: prefCtx.patient?.reason ?? "",
            }),
          }).catch(console.error);
          console.log("Preferred slot booked for:", prefCtx.patient.email);
        } else if (prefCtx.patient?.email) {
          // Slot not available — fetch available slots for matched doctor and notify
          const preferredDisplay = `${normalizedPrefDate} at ${ai_result.preferredTime}`;
          let availableSlots: { date: string; time: string }[] = [];
          if (prefCtx.matchedDoctor?.id) {
            availableSlots = await prisma.slot.findMany({
              where: { doctorId: prefCtx.matchedDoctor.id, available: true },
              orderBy: [{ date: "asc" }, { time: "asc" }],
              take: 6,
              select: { date: true, time: true },
            });
          }
          await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patient: prefCtx.patient, doctor: prefCtx.matchedDoctor ?? {}, slot: {},
              type: "slot_unavailable", preferredTime: preferredDisplay, availableSlots,
            }),
          }).catch(console.error);
          console.log("Unavailable slot notified for:", prefCtx.patient.email);
        }
      }

      if (ai_result?.appointmentBooked && ai_result.selectedDate && ai_result.selectedTime) {
        const normalizedTime = normalizeTime(ai_result.selectedTime);
        context.selectedSlot = { date: ai_result.selectedDate, time: normalizedTime, available: true };
        context.step = "booked";

        // Look up doctor from slot if not in context
        if (!context.matchedDoctor) {
          const slot = await prisma.slot.findFirst({
            where: { date: ai_result.selectedDate, time: normalizedTime },
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

        await prisma.session.update({ where: { id: sessionId }, data: { step: "booked", context } });

        // Re-read DB: transcript may have already saved email
        const freshForEmail = await prisma.session.findUnique({ where: { id: sessionId } });
        const emailCtx = (freshForEmail?.context as any) ?? context;
        if (emailCtx.patient?.email && emailCtx.matchedDoctor && emailCtx.selectedSlot && !emailCtx.bookingConfirmed) {
          // Full booking flow: mark slot unavailable + send notifications
          const bookRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patient: emailCtx.patient,
              doctor: emailCtx.matchedDoctor,
              slot: emailCtx.selectedSlot,
              reason: emailCtx.patient?.reason ?? "",
            }),
          }).catch(console.error);
          if (bookRes && (bookRes as Response).ok) {
            emailCtx.bookingConfirmed = true;
            await prisma.session.update({ where: { id: sessionId }, data: { context: emailCtx } });
          }
          console.log("Booking + notifications sent (from extractor) to:", emailCtx.patient.email);
        } else {
          console.log("No email yet, dial.transcript will send it");
        }
      }
    }

    // dial.transcript: extract email, then send email notification
    if (event === "dial.transcript") {
      const { dial_id, transcript } = payload;
      const sessionId = dialSessionMap.get(dial_id);
      if (!sessionId) return NextResponse.json({ ok: true });

      const dbSession = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!dbSession) return NextResponse.json({ ok: true });

      const context = (dbSession.context as any) ?? {};
      context.voiceTranscript = transcript;

      // Extract email and reason from transcript
      const extracted = await extractPatientInfoFromTranscript(transcript).catch(() => null);
      console.log("Extracted patient info:", extracted);

      if (extracted?.email && !context.patient?.email) {
        context.patient = { ...context.patient, email: extracted.email };
      }
      if (extracted?.reason && !context.patient?.reason) {
        context.patient = { ...context.patient, reason: extracted.reason };
      }

      // Match doctor if not already matched
      if (!context.matchedDoctor && context.patient?.reason) {
        const doctor = await matchDoctorByReason(context.patient.reason).catch(() => null);
        if (doctor) context.matchedDoctor = doctor;
      }

      await prisma.session.update({ where: { id: sessionId }, data: { context } });

      // Re-read DB to get latest state (extractor may have set step=booked concurrently)
      const fresh = await prisma.session.findUnique({ where: { id: sessionId } });
      const freshCtx = (fresh?.context as any) ?? {};

      // Merge transcript-extracted fields into fresh context
      if (context.patient?.email) freshCtx.patient = { ...freshCtx.patient, email: context.patient.email };
      if (context.matchedDoctor) freshCtx.matchedDoctor = context.matchedDoctor;

      // If booked but /api/book hasn't been called yet (email arrived after extractor),
      // call /api/book now to mark slot and send notifications
      if (freshCtx.step === "booked" && freshCtx.patient?.email && freshCtx.matchedDoctor && freshCtx.selectedSlot && !freshCtx.bookingConfirmed) {
        await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/book`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient: freshCtx.patient,
            doctor: freshCtx.matchedDoctor,
            slot: freshCtx.selectedSlot,
            reason: freshCtx.patient?.reason ?? "",
          }),
        }).catch(console.error);
        console.log("Booking triggered from transcript for:", freshCtx.patient.email);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
