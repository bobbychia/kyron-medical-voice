import { Doctor } from "@/types";
import { addDays, format } from "@/lib/dateUtils";

function generateSlots(startOffset: number, days: number, times: string[]): Doctor["availability"] {
  const slots = [];
  for (let d = startOffset; d < startOffset + days; d++) {
    const date = format(addDays(new Date(), d));
    // Skip weekends
    const dayOfWeek = addDays(new Date(), d).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    for (const time of times) {
      slots.push({ date, time, available: true });
    }
  }
  return slots;
}

export const DOCTORS: Doctor[] = [
  {
    id: "dr-chen",
    name: "Dr. Lisa Chen",
    specialty: "Orthopedic Surgery",
    bodyParts: ["knee", "hip", "shoulder", "joint", "bone", "spine", "back", "ankle", "wrist", "elbow", "fracture", "arthritis"],
    bio: "Board-certified orthopedic surgeon with 15 years of experience in joint replacement and sports medicine.",
    availability: generateSlots(1, 45, ["09:00", "10:00", "11:00", "14:00", "15:00"]),
  },
  {
    id: "dr-patel",
    name: "Dr. Raj Patel",
    specialty: "Cardiology",
    bodyParts: ["heart", "chest", "cardiac", "cardiovascular", "blood pressure", "palpitation", "arrhythmia", "cholesterol", "shortness of breath"],
    bio: "Interventional cardiologist specializing in heart disease prevention and minimally invasive procedures.",
    availability: generateSlots(1, 45, ["08:30", "10:30", "13:00", "15:30"]),
  },
  {
    id: "dr-kim",
    name: "Dr. Sarah Kim",
    specialty: "Neurology",
    bodyParts: ["head", "brain", "migraine", "headache", "nerve", "neurological", "seizure", "dizziness", "numbness", "memory", "stroke", "tremor"],
    bio: "Neurologist specializing in headache disorders, epilepsy, and neurodegenerative diseases.",
    availability: generateSlots(1, 45, ["09:30", "11:00", "14:00", "16:00"]),
  },
  {
    id: "dr-torres",
    name: "Dr. Miguel Torres",
    specialty: "Gastroenterology",
    bodyParts: ["stomach", "abdomen", "digestive", "gut", "bowel", "colon", "liver", "nausea", "heartburn", "bloating", "acid reflux", "constipation", "diarrhea"],
    bio: "Gastroenterologist with expertise in inflammatory bowel disease and digestive health.",
    availability: generateSlots(1, 45, ["08:00", "10:00", "13:30", "15:00"]),
  },
];

export const PRACTICE_INFO = {
  name: "Kyron Medical Group",
  address: "123 Health Plaza, Suite 400, Boston, MA 02101",
  phone: "(617) 555-0100",
  hours: "Monday–Friday: 8:00 AM – 6:00 PM",
  email: "appointments@kyronmedical.com",
};

export function matchDoctorByReason(reason: string): Doctor | null {
  const lowerReason = reason.toLowerCase();
  let bestMatch: Doctor | null = null;
  let maxMatches = 0;

  for (const doctor of DOCTORS) {
    const matches = doctor.bodyParts.filter((part) =>
      lowerReason.includes(part)
    ).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = doctor;
    }
  }

  return bestMatch;
}

export function getAvailableSlots(doctorId: string, limit = 10): Doctor["availability"] {
  const doctor = DOCTORS.find((d) => d.id === doctorId);
  if (!doctor) return [];
  return doctor.availability.filter((s) => s.available).slice(0, limit);
}

export function bookSlot(doctorId: string, date: string, time: string): boolean {
  const doctor = DOCTORS.find((d) => d.id === doctorId);
  if (!doctor) return false;
  const slot = doctor.availability.find((s) => s.date === date && s.time === time);
  if (!slot || !slot.available) return false;
  slot.available = false;
  return true;
}
