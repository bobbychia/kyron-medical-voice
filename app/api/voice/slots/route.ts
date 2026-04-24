import { NextRequest, NextResponse } from "next/server";
import { matchDoctorByReason, getAvailableSlots } from "@/lib/doctorsDb";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { reason, sessionId, email } = await req.json();

    if (!reason) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const doctor = await matchDoctorByReason(reason);
    if (!doctor) {
      return NextResponse.json({
        message: "No matching doctor found for this condition. Our practice may not treat this condition.",
        slots: [],
      });
    }

    const slots = await getAvailableSlots(doctor.id, 3);

    // Save matched doctor (and email if provided) to session during the call
    if (sessionId) {
      const dbSession = await prisma.session.findUnique({ where: { id: sessionId } });
      if (dbSession) {
        const context = (dbSession.context as any) ?? {};
        context.matchedDoctor = doctor;
        if (email && !context.patient?.email) {
          context.patient = { ...context.patient, email };
        }
        if (!context.patient?.reason) {
          context.patient = { ...context.patient, reason };
        }
        await prisma.session.update({ where: { id: sessionId }, data: { context } });
      }
    }

    return NextResponse.json({
      doctor: doctor.name,
      specialty: doctor.specialty,
      slots: slots.map((s, i) => `${i + 1}. ${s.date} at ${s.time}`),
      message: `Matched with ${doctor.name} (${doctor.specialty}). Available slots: ${slots.map((s, i) => `${i + 1}. ${s.date} at ${s.time}`).join(", ")}`,
    });
  } catch (error) {
    console.error("Slots error:", error);
    return NextResponse.json({ error: "Failed to fetch slots" }, { status: 500 });
  }
}
