const { cert, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

const TIME_ZONE = process.env.CLINIC_TIME_ZONE || "America/Chicago";
process.env.TZ = TIME_ZONE;

const requiredSecrets = ["FIREBASE_SERVICE_ACCOUNT_B64", "GMAIL_USER", "GMAIL_APP_PASSWORD"];
const missingSecrets = requiredSecrets.filter((name) => !process.env[name]);
if (missingSecrets.length) throw new Error(`Faltan secretos: ${missingSecrets.join(", ")}`);

const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8"));
initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const dryRun = process.env.DRY_RUN === "true";
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD.replaceAll(" ", "")
  }
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatAppointment(date, language) {
  return new Intl.DateTimeFormat(language === "Inglés" ? "en-US" : "es-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function birthdayMessage(patient, clinicName) {
  const name = patient.name || "";
  if (patient.language === "Inglés") {
    return {
      subject: `Happy birthday, ${name}!`,
      text: `Happy birthday, ${name}! We hope you have a wonderful day filled with health and happiness. Best wishes from ${clinicName}.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2 style="color:#0f766e">Happy birthday, ${escapeHtml(name)}!</h2><p>We hope you have a wonderful day filled with health and happiness.</p><p>Best wishes from <strong>${escapeHtml(clinicName)}</strong>.</p></div>`
    };
  }
  return {
    subject: `¡Feliz cumpleaños, ${name}!`,
    text: `¡Feliz cumpleaños, ${name}! Esperamos que disfrutes un día maravilloso lleno de salud y alegría. Con cariño, ${clinicName}.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2 style="color:#0f766e">¡Feliz cumpleaños, ${escapeHtml(name)}!</h2><p>Esperamos que disfrutes un día maravilloso lleno de salud y alegría.</p><p>Con cariño, <strong>${escapeHtml(clinicName)}</strong>.</p></div>`
  };
}

function appointmentMessage(patient, clinicName, visitDate) {
  const name = patient.name || "";
  const formattedDate = formatAppointment(visitDate, patient.language);
  if (patient.language === "Inglés") {
    return {
      subject: `Appointment reminder · ${clinicName}`,
      text: `Hello ${name}. This is a reminder that you have an appointment on ${formattedDate} at ${clinicName}. Please contact us if you need to reschedule.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2 style="color:#0f766e">Appointment reminder</h2><p>Hello ${escapeHtml(name)},</p><p>You have an appointment on <strong>${escapeHtml(formattedDate)}</strong> at <strong>${escapeHtml(clinicName)}</strong>.</p><p>Please contact us if you need to reschedule.</p></div>`
    };
  }
  return {
    subject: `Recordatorio de cita · ${clinicName}`,
    text: `Hola ${name}. Te recordamos que tienes una cita el ${formattedDate} en ${clinicName}. Comunícate con nosotros si necesitas cambiarla.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2 style="color:#0f766e">Recordatorio de cita</h2><p>Hola ${escapeHtml(name)},</p><p>Tienes una cita el <strong>${escapeHtml(formattedDate)}</strong> en <strong>${escapeHtml(clinicName)}</strong>.</p><p>Comunícate con nosotros si necesitas cambiarla.</p></div>`
  };
}

async function clinicSettingsFor(clinicRef, cache) {
  if (!cache.has(clinicRef.id)) {
    const settings = await clinicRef.collection("settings").doc("clinic").get();
    const data = settings.data() || {};
    cache.set(clinicRef.id, {
      clinicName: data.clinicName || "Clinic Control",
      senderEmail: data.senderEmail || data.clinicEmail || process.env.GMAIL_USER
    });
  }
  return cache.get(clinicRef.id);
}

async function sendOnce({ id, to, message, clinic, metadata }) {
  const logRef = db.collection("emailLogs").doc(id);
  if ((await logRef.get()).exists) return false;

  if (dryRun) {
    console.log(`[DRY RUN] ${message.subject} -> ${to}`);
    return true;
  }

  const result = await transporter.sendMail({
    from: `${clinic.clinicName} <${clinic.senderEmail}>`,
    replyTo: clinic.senderEmail,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html
  });

  await logRef.create({
    ...metadata,
    recipient: to,
    messageId: result.messageId,
    sentAt: FieldValue.serverTimestamp()
  });
  return true;
}

async function sendBirthdayEmails(clinicNames) {
  const today = localDateKey();
  const suffix = today.slice(4);
  const year = today.slice(0, 4);
  const patients = await db.collectionGroup("patients").get();
  let sent = 0;

  for (const doc of patients.docs) {
    const patient = doc.data();
    if (!patient.emailNotificationsEnabled || !patient.birthdayEmailEnabled || !patient.email || !patient.birthDate?.endsWith(suffix)) continue;
    const clinicRef = doc.ref.parent.parent;
    if (!clinicRef) continue;
    const clinic = await clinicSettingsFor(clinicRef, clinicNames);
    if (await sendOnce({
      id: `birthday_${clinicRef.id}_${doc.id}_${year}`,
      to: patient.email,
      message: birthdayMessage(patient, clinic.clinicName),
      clinic,
      metadata: { type: "birthday", clinicId: clinicRef.id, patientId: doc.id, year }
    })) sent += 1;
  }
  return sent;
}

async function sendAppointmentReminders(clinicNames) {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const visits = await db.collectionGroup("visits").get();
  let sent = 0;

  for (const doc of visits.docs) {
    const visit = doc.data();
    if (visit.status !== "Programada" || !visit.reminderEnabled || !visit.date) continue;
    const appointmentDate = new Date(visit.date);
    if (Number.isNaN(appointmentDate.getTime()) || appointmentDate < windowStart || appointmentDate > windowEnd) continue;

    const clinicRef = doc.ref.parent.parent;
    if (!clinicRef || !visit.patientId) continue;
    const patientDoc = await clinicRef.collection("patients").doc(visit.patientId).get();
    const patient = patientDoc.data();
    if (!patient?.email || !patient.emailNotificationsEnabled) continue;
    const clinic = await clinicSettingsFor(clinicRef, clinicNames);

    if (await sendOnce({
      id: `appointment_${clinicRef.id}_${doc.id}_24h`,
      to: patient.email,
      message: appointmentMessage(patient, clinic.clinicName, appointmentDate),
      clinic,
      metadata: { type: "appointment", clinicId: clinicRef.id, patientId: patientDoc.id, visitId: doc.id }
    })) sent += 1;
  }
  return sent;
}

async function main() {
  const clinicNames = new Map();
  if (!dryRun) await transporter.verify();
  const birthdays = await sendBirthdayEmails(clinicNames);
  const appointments = await sendAppointmentReminders(clinicNames);
  console.log(`Proceso terminado. Cumpleaños: ${birthdays}; citas: ${appointments}; prueba: ${dryRun}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
