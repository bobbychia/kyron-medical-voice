export type AIModel = "claude" | "gpt" | "gemini";

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  bodyParts: string[];
  bio: string;
  availability: AvailabilitySlot[];
}

export interface AvailabilitySlot {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  available: boolean;
}

export interface PatientInfo {
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  email: string;
  reason: string;
}

export interface Appointment {
  id: string;
  patient: PatientInfo;
  doctor: Doctor;
  slot: AvailabilitySlot;
  bookedAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export type ConversationStep =
  | "greeting"
  | "collect_name"
  | "collect_dob"
  | "collect_phone"
  | "collect_email"
  | "collect_reason"
  | "match_doctor"
  | "show_slots"
  | "confirm_booking"
  | "booked"
  | "general";

export interface ConversationState {
  step: ConversationStep;
  patient: Partial<PatientInfo>;
  matchedDoctor?: Doctor;
  selectedSlot?: AvailabilitySlot;
  sessionId: string;
}
