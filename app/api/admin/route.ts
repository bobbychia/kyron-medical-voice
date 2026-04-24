import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const doctors = await prisma.doctor.findMany({
    include: {
      slots: { orderBy: [{ date: "asc" }, { time: "asc" }] },
      appointments: {
        include: { patient: true, slot: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return NextResponse.json(doctors);
}

// Toggle slot availability
export async function PATCH(req: NextRequest) {
  const { slotId, available } = await req.json();
  const slot = await prisma.slot.update({
    where: { id: slotId },
    data: { available },
  });
  return NextResponse.json(slot);
}

// Add a new slot
export async function POST(req: NextRequest) {
  const { doctorId, date, time } = await req.json();
  const slot = await prisma.slot.create({
    data: { doctorId, date, time, available: true },
  });
  return NextResponse.json(slot);
}

// Delete a slot
export async function DELETE(req: NextRequest) {
  const { slotId } = await req.json();
  await prisma.slot.delete({ where: { id: slotId } });
  return NextResponse.json({ success: true });
}
