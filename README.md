# Kyron Medical Voice

This is a patient-facing scheduling demo for Kyron Medical. Patients can start in a web chat, complete intake, book an appointment, request a refill, check the next available appointment, or get office info. They can also switch from chat to a phone call through Vogent while keeping the same conversation context.

Live app:

```text
https://3.19.15.231.nip.io
```

Demo video:

```text
https://youtu.be/igjYxiOABm0
```

The app is deployed on AWS EC2 and uses AWS RDS for persistent data.

## Highlight Points

- Chat and voice share the same session, so the phone call can continue from the web chat instead of starting over.
- The scheduling flow checks live database availability before confirming a booking.
- Admin slot changes are handled safely. If a patient chooses a slot that was just blocked or deleted, the app explains that the administrator updated it and refreshes the latest slots.
- The next-available flow returns the earliest open time for each doctor and then goes back to the main menu.
- Preferred times from voice calls are checked against the database. If the time is available, it can be booked; if not, the patient gets an unavailable-time email with other options.
- Prescription refill is its own flow, so it does not ask appointment questions like reason for visit or specialty.
- Confirmation, refill, and unavailable-time notifications are sent by email, with SMS support available when enabled.

## What It Does

- Appointment scheduling with patient intake:
  - name
  - date of birth
  - phone
  - email
  - reason for visit
- Doctor matching based on the patient's concern/body part
- Live availability pulled from the database
- Slot booking with double-booking protection
- Confirmation emails through Gmail/Nodemailer
- Optional SMS reminders through Twilio
- Prescription refill request flow
- Office hours and location flow
- "Next available appointment" lookup
- Voice handoff through Vogent
- Admin dashboard for changing provider availability

## Main Flows

### 1. Schedule an Appointment

The assistant collects the required appointment fields, matches the patient to one of four doctors, shows available slots, asks for confirmation, and then books the slot.

The final booking happens server-side before the assistant says the appointment is confirmed. This avoids stale slot issues when two browser windows try to book the same time.

### 2. Check Next Available

The assistant checks the database and returns the earliest open time for each doctor, then returns to the main menu.

### 3. Prescription Refill

The refill flow is separate from appointment scheduling. It does not ask for appointment reason, DOB, specialty, or appointment slots. It only collects:

- name
- phone
- prescribing doctor
- medication name

Then it sends the request to the practice email.

### 4. Office Hours and Location

The assistant gives the practice address, phone number, and hours, then returns to the main menu.

## Voice Handoff

The "Call me" button sends the current chat state to Vogent. The voice agent receives:

- current flow
- patient context
- missing fields
- matched doctor
- available slots
- refill fields when relevant

The Vogent prompt should use the `flow` and `taskInstructions` fields first. Without that, the voice agent may fall back into the wrong flow.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL on AWS RDS
- AWS EC2
- PM2
- Vogent for voice AI
- Nodemailer/Gmail for email
- Twilio for SMS
- Claude, OpenAI, and Gemini support for chat model comparison

## Local Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file with the required keys:

```bash
DATABASE_URL=
NEXT_PUBLIC_BASE_URL=

ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=

VOGENT_API_KEY=
VOGENT_AGENT_ID=
VOGENT_FROM_NUMBER_ID=

GMAIL_USER=
GMAIL_APP_PASSWORD=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

ADMIN_USERNAME=
ADMIN_PASSWORD=
```

Run the database seed if needed:

```bash
npm run db:seed
```

Start the dev server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Admin

The admin dashboard is available at:

```text
/admin/login
```

From there, provider slots can be added, removed, or toggled available/unavailable. The chat flow reads availability from the database, so changes affect new slot lookups immediately.

## Deployment

Pushes to `main` deploy through GitHub Actions:

```text
git pull
npm install
npm run build
pm2 restart kyron-medical --update-env
```

The workflow is in:

```text
.github/workflows/deploy.yml
```

## Notes

- Local testing may still use the production RDS database depending on the `.env` file, so booking a slot locally can affect the live availability.
- Vogent cannot call back to `localhost`; voice testing needs the deployed URL or a tunnel.
- SMS depends on the Twilio number being valid for the destination country.
- Email sending depends on a Gmail app password, not the normal Gmail account password.

## Useful Commands

```bash
npm run dev
npm run build
npm run lint
npm run db:seed
npm run db:studio
```
