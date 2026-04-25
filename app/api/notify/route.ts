import { NextRequest, NextResponse } from "next/server";
import { PatientInfo, Doctor, AvailabilitySlot } from "@/types";
import { formatDisplay } from "@/lib/dateUtils";
import { PRACTICE_INFO } from "@/lib/doctors";

export async function POST(req: NextRequest) {
  const { patient, doctor, slot, type, preferredTime, availableSlots } = await req.json() as {
    patient: PatientInfo;
    doctor: Doctor;
    slot: AvailabilitySlot;
    type?: string;
    preferredTime?: string;
    availableSlots?: { date: string; time: string }[];
  };

  if (type === "prescription_refill") {
    const medication = preferredTime ?? "unspecified";
    await sendRefillEmail(patient, medication).catch(console.error);
    return NextResponse.json({ ok: true });
  }

  if (type === "slot_unavailable") {
    const results = await Promise.allSettled([
      sendUnavailableEmail(patient, preferredTime ?? "your requested time", availableSlots ?? []),
      sendUnavailableSMS(patient, preferredTime ?? "your requested time", availableSlots ?? []),
    ]);
    console.log("Unavailable notify results:", {
      toEmail: patient.email,
      email: results[0].status,
      sms: results[1].status,
    });
    return NextResponse.json({ email: results[0].status, sms: results[1].status });
  }

  const appointmentTime = formatDisplay(slot.date, slot.time);

  const results = await Promise.allSettled([
    sendEmail(patient, doctor, appointmentTime),
    (patient as any).smsConsent ? sendSMS(patient, doctor, appointmentTime) : Promise.resolve(),
  ]);

  console.log("Notify results:", {
    toEmail: patient.email,
    email: results[0].status,
    emailError: results[0].status === "rejected" ? (results[0] as any).reason?.message : undefined,
    sms: results[1].status,
    smsError: results[1].status === "rejected" ? (results[1] as any).reason?.message : undefined,
  });

  return NextResponse.json({
    email: results[0].status,
    sms: results[1].status,
  });
}

async function sendEmail(patient: PatientInfo, doctor: Doctor, appointmentTime: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;

  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"${PRACTICE_INFO.name}" <${process.env.GMAIL_USER}>`,
    to: patient.email,
    subject: `Appointment Confirmed — ${PRACTICE_INFO.name}`,
    html: `
      <h2>Your appointment is confirmed!</h2>
      <p>Hello ${patient.firstName},</p>
      <p>Your appointment has been scheduled:</p>
      <ul>
        <li><strong>Doctor:</strong> ${doctor.name} (${doctor.specialty})</li>
        <li><strong>Date & Time:</strong> ${appointmentTime}</li>
        <li><strong>Location:</strong> ${PRACTICE_INFO.address}</li>
      </ul>
      <p>If you need to reschedule, please call us at ${PRACTICE_INFO.phone}.</p>
      <p>— ${PRACTICE_INFO.name}</p>
    `,
  });
}

async function sendSMS(patient: PatientInfo, doctor: Doctor, appointmentTime: string) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;

  const twilio = (await import("twilio")).default;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  await client.messages.create({
    body: `${PRACTICE_INFO.name}: Your appointment with ${doctor.name} is confirmed for ${appointmentTime}. Questions? Call ${PRACTICE_INFO.phone}.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: `+1${patient.phone.replace(/\D/g, "")}`,
  });
}

async function sendUnavailableEmail(patient: PatientInfo, preferredTime: string, availableSlots: { date: string; time: string }[]) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;

  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${PRACTICE_INFO.name}" <${process.env.GMAIL_USER}>`,
    to: patient.email,
    subject: `Appointment Request Update — ${PRACTICE_INFO.name}`,
    html: `
      <h2>We're sorry, that time isn't available</h2>
      <p>Hello ${patient.firstName},</p>
      <p>Unfortunately, <strong>${preferredTime}</strong> is not currently available.</p>
      ${availableSlots.length > 0 ? `
      <p>Here are our next available times:</p>
      <ul>${availableSlots.map(s => `<li>${formatDisplay(s.date, s.time)}</li>`).join("")}</ul>
      <p>Please call us to book one of these times, or let us know what works for you:</p>
      ` : `<p>Please contact us to find a time that works for you:</p>`}
      <ul>
        <li><strong>Phone:</strong> ${PRACTICE_INFO.phone}</li>
        <li><strong>Address:</strong> ${PRACTICE_INFO.address}</li>
        <li><strong>Hours:</strong> ${PRACTICE_INFO.hours}</li>
      </ul>
      <p>We look forward to seeing you soon!</p>
      <p>— ${PRACTICE_INFO.name}</p>
    `,
  });
}

async function sendRefillEmail(patient: PatientInfo, medication: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;

  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${PRACTICE_INFO.name}" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `Prescription Refill Request — ${patient.firstName} ${patient.lastName}`,
    html: `
      <h2>New Prescription Refill Request</h2>
      <ul>
        <li><strong>Patient:</strong> ${patient.firstName} ${patient.lastName}</li>
        <li><strong>Phone:</strong> ${patient.phone}</li>
        <li><strong>Medication:</strong> ${medication}</li>
      </ul>
      <p>Please follow up with the patient within 1–2 business days.</p>
      <p>— ${PRACTICE_INFO.name} AI Assistant</p>
    `,
  });
}

async function sendUnavailableSMS(patient: PatientInfo, preferredTime: string, availableSlots: { date: string; time: string }[]) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;

  const twilio = (await import("twilio")).default;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  const hasSlots = availableSlots.length > 0;

  await client.messages.create({
    body: `${PRACTICE_INFO.name}: Sorry, ${preferredTime} is not available.${hasSlots ? " Check your email for available times." : ""} Call us at ${PRACTICE_INFO.phone}.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: `+1${patient.phone.replace(/\D/g, "")}`,
  });
}
