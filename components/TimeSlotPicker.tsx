"use client";

import { Doctor, AvailabilitySlot } from "@/types";
import { formatDisplay } from "@/lib/dateUtils";
import { Calendar, Clock } from "lucide-react";

interface Props {
  doctor: Doctor;
  slots: AvailabilitySlot[];
  onSelect: (slot: AvailabilitySlot) => void;
}

export default function TimeSlotPicker({ doctor, slots, onSelect }: Props) {
  // Group slots by date
  const grouped = slots.reduce<Record<string, AvailabilitySlot[]>>((acc, slot) => {
    if (!acc[slot.date]) acc[slot.date] = [];
    acc[slot.date].push(slot);
    return acc;
  }, {});

  return (
    <div className="bg-white border border-blue-100 rounded-2xl p-4 shadow-sm ml-11">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-blue-600" />
        <p className="text-sm font-medium text-gray-700">
          Available times with {doctor.name}
        </p>
      </div>
      <div className="space-y-3">
        {Object.entries(grouped).slice(0, 5).map(([date, dateSlots]) => (
          <div key={date}>
            <p className="text-xs font-medium text-gray-500 mb-1.5">
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {dateSlots.map((slot, i) => (
                <button
                  key={i}
                  onClick={() => onSelect(slot)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium rounded-lg transition-colors border border-blue-100"
                >
                  <Clock className="w-3 h-3" />
                  {slot.time}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
