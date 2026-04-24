import { prisma } from "@/lib/db";
import { Doctor, AvailabilitySlot } from "@/types";

export async function matchDoctorByReason(reason: string): Promise<Doctor | null> {
  const doctors = await prisma.doctor.findMany();
  const lowerReason = reason.toLowerCase();

  let bestMatch: Doctor | null = null;
  let maxMatches = 0;

  for (const doc of doctors) {
    const matches = doc.bodyParts.filter((part) =>
      lowerReason.includes(part.toLowerCase())
    ).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = {
        id: doc.id,
        name: doc.name,
        specialty: doc.specialty,
        bodyParts: doc.bodyParts,
        bio: doc.bio,
        availability: [],
      };
    }
  }

  return bestMatch;
}

export async function getAvailableSlots(doctorId: string, limit = 5): Promise<AvailabilitySlot[]> {
  const today = new Date().toISOString().split("T")[0];
  const slots = await prisma.slot.findMany({
    where: { doctorId, available: true, date: { gte: today } },
    orderBy: [{ date: "asc" }, { time: "asc" }],
    take: limit,
  });

  return slots.map((s) => ({ date: s.date, time: s.time, available: s.available }));
}

export async function bookSlot(doctorId: string, date: string, time: string): Promise<boolean> {
  const slot = await prisma.slot.findFirst({
    where: { doctorId, date, time, available: true },
  });

  if (!slot) return false;

  await prisma.slot.update({
    where: { id: slot.id },
    data: { available: false },
  });

  return true;
}

export async function checkSlotAvailable(doctorId: string, date: string, time: string): Promise<AvailabilitySlot | null> {
  const slot = await prisma.slot.findFirst({
    where: { doctorId, date, time, available: true },
  });
  if (!slot) return null;
  return { date: slot.date, time: slot.time, available: slot.available };
}

export async function getAllDoctors(): Promise<Doctor[]> {
  const doctors = await prisma.doctor.findMany();
  return doctors.map((doc) => ({
    id: doc.id,
    name: doc.name,
    specialty: doc.specialty,
    bodyParts: doc.bodyParts,
    bio: doc.bio,
    availability: [],
  }));
}
