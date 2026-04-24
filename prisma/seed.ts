import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

async function main() {
  console.log("Seeding database...");

  await prisma.slot.deleteMany();
  await prisma.doctor.deleteMany();

  const doctors = [
    {
      name: "Dr. Lisa Chen",
      specialty: "Orthopedic Surgery",
      bodyParts: ["knee", "hip", "shoulder", "joint", "bone", "spine", "back", "ankle", "wrist", "elbow", "fracture", "arthritis"],
      bio: "Board-certified orthopedic surgeon with 15 years of experience in joint replacement and sports medicine.",
      times: ["09:00", "10:00", "11:00", "14:00", "15:00"],
    },
    {
      name: "Dr. Raj Patel",
      specialty: "Cardiology",
      bodyParts: ["heart", "chest", "cardiac", "cardiovascular", "blood pressure", "palpitation", "arrhythmia", "cholesterol"],
      bio: "Interventional cardiologist specializing in heart disease prevention and minimally invasive procedures.",
      times: ["08:30", "10:30", "13:00", "15:30"],
    },
    {
      name: "Dr. Sarah Kim",
      specialty: "Neurology",
      bodyParts: ["head", "brain", "migraine", "headache", "nerve", "neurological", "seizure", "dizziness", "numbness", "memory", "stroke"],
      bio: "Neurologist specializing in headache disorders, epilepsy, and neurodegenerative diseases.",
      times: ["09:30", "11:00", "14:00", "16:00"],
    },
    {
      name: "Dr. Miguel Torres",
      specialty: "Gastroenterology",
      bodyParts: ["stomach", "abdomen", "digestive", "gut", "bowel", "colon", "liver", "nausea", "heartburn", "bloating", "acid reflux"],
      bio: "Gastroenterologist with expertise in inflammatory bowel disease and digestive health.",
      times: ["08:00", "10:00", "13:30", "15:00"],
    },
  ];

  for (const d of doctors) {
    const doctor = await prisma.doctor.create({
      data: {
        name: d.name,
        specialty: d.specialty,
        bodyParts: d.bodyParts,
        bio: d.bio,
      },
    });

    const slots = [];
    for (let i = 1; i <= 45; i++) {
      const date = addDays(new Date(), i);
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      for (const time of d.times) {
        slots.push({ doctorId: doctor.id, date: formatDate(date), time, available: true });
      }
    }

    await prisma.slot.createMany({ data: slots });
    console.log(`Created ${doctor.name} with ${slots.length} slots`);
  }

  console.log("Done!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
