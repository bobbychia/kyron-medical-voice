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
  return NextResponse.json(doctors, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

// Toggle slot availability
export async function PATCH(req: NextRequest) {
  try {
    const { slotId, available } = await req.json();
    const slot = await prisma.slot.update({
      where: { id: slotId },
      data: { available },
    });
    return NextResponse.json(slot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Admin slot update error:", error);
    return NextResponse.json({ error: "Failed to update slot" }, { status: 500 });
  }
}

// Add a new slot
export async function POST(req: NextRequest) {
  try {
    const { doctorId, date, time } = await req.json();
    const slot = await prisma.slot.create({
      data: { doctorId, date, time, available: true },
    });
    return NextResponse.json(slot);
  } catch (error) {
    console.error("Admin slot create error:", error);
    return NextResponse.json({ error: "Failed to create slot" }, { status: 500 });
  }
}

// Delete a slot
export async function DELETE(req: NextRequest) {
  try {
    const { slotId } = await req.json();
    await prisma.slot.delete({ where: { id: slotId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin slot delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete slot. Booked slots should be blocked instead of deleted." },
      { status: 409 }
    );
  }
}
