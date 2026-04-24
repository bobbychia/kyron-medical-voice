import { NextRequest, NextResponse } from "next/server";
import { bookSlot } from "@/lib/doctorsDb";
import { prisma } from "@/lib/db";
import { PatientInfo, AvailabilitySlot, Doctor } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const { patient, doctor, slot, reason } = await req.json() as {
      patient: PatientInfo;
      doctor: Doctor;
      slot: AvailabilitySlot;
      reason: string;
    };

    const success = await bookSlot(doctor.id, slot.date, slot.time);
    if (!success) {
      return NextResponse.json({ error: "Slot no longer available" }, { status: 409 });
    }

    // Save patient and appointment to database
    const dbPatient = await prisma.patient.upsert({
      where: { email: patient.email },
      update: {},
      create: {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dob: patient.dob,
        phone: patient.phone,
        email: patient.email,
      },
    });

    const dbSlot = await prisma.slot.findFirst({
      where: { doctorId: doctor.id, date: slot.date, time: slot.time },
    });

    if (dbSlot) {
      await prisma.appointment.create({
        data: {
          patientId: dbPatient.id,
          doctorId: doctor.id,
          slotId: dbSlot.id,
          reason: reason ?? "",
          status: "confirmed",
        },
      });
    }

    // Fire-and-forget notifications
    fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient, doctor, slot }),
    }).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Booking error:", error);
    return NextResponse.json({ error: "Failed to book appointment" }, { status: 500 });
  }
}
