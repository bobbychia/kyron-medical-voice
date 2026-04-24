import { NextRequest, NextResponse } from "next/server";
import { PatientInfo, Doctor, AvailabilitySlot } from "@/types";
import { formatDisplay } from "@/lib/dateUtils";
import { PRACTICE_INFO } from "@/lib/doctors";

export async function POST(req: NextRequest) {
  const { patient, doctor, slot } = await req.json() as {
    patient: PatientInfo;
    doctor: Doctor;
    slot: AvailabilitySlot;
  };

  const appointmentTime = formatDisplay(slot.date, slot.time);

  const results = await Promise.allSettled([
    sendEmail(patient, doctor, appointmentTime),
    sendSMS(patient, doctor, appointmentTime),
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
