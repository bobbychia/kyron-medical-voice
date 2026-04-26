import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/doctorsDb";

export async function GET(req: NextRequest) {
  const doctorId = req.nextUrl.searchParams.get("doctorId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 3;

  if (!doctorId) {
    return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
  }

  const slots = await getAvailableSlots(doctorId, Number.isFinite(limit) ? limit : 3);
  return NextResponse.json(
    { slots },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
