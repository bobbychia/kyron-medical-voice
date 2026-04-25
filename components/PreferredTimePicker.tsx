"use client";

import { useState } from "react";
import { Calendar, Clock, Send } from "lucide-react";
import { AvailabilitySlot } from "@/types";

interface Props {
  slots: AvailabilitySlot[];
  onSelect: (slot: AvailabilitySlot) => void;
}

function formatDateLabel(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}

function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function PreferredTimePicker({ slots, onSelect }: Props) {
  const grouped = slots.reduce<Record<string, AvailabilitySlot[]>>((acc, slot) => {
    if (!acc[slot.date]) acc[slot.date] = [];
    acc[slot.date].push(slot);
    return acc;
  }, {});

  const dates = Object.keys(grouped).sort();
  const [selectedDate, setSelectedDate] = useState(dates[0] ?? "");
  const [selectedTime, setSelectedTime] = useState("");

  const timesForDate = grouped[selectedDate] ?? [];
  const selectedSlot = timesForDate.find((s) => s.time === selectedTime);

  return (
    <div className="bg-white border border-blue-100 rounded-2xl p-4 shadow-sm ml-11 max-w-sm">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-blue-600" />
        <p className="text-sm font-medium text-gray-700">Choose a preferred date & time</p>
      </div>

      <div className="mb-3">
        <label className="text-xs text-gray-500 mb-1.5 block">Date</label>
        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
          {dates.map((d) => (
            <button
              key={d}
              onClick={() => { setSelectedDate(d); setSelectedTime(""); }}
              className={`text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                selectedDate === d
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-blue-50 hover:border-blue-200"
              }`}
            >
              {formatDateLabel(d)}
            </button>
          ))}
        </div>
      </div>

      {selectedDate && (
        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Available times
          </label>
          <div className="flex flex-wrap gap-1.5">
            {timesForDate.map((slot) => (
              <button
                key={slot.time}
                onClick={() => setSelectedTime(slot.time)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  selectedTime === slot.time
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100"
                }`}
              >
                {formatTime(slot.time)}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => selectedSlot && onSelect(selectedSlot)}
        disabled={!selectedSlot}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium py-2 rounded-xl transition-colors"
      >
        <Send className="w-3.5 h-3.5" />
        Request this time
      </button>
    </div>
  );
}
