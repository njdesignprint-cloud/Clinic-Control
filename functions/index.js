const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();
const TIME_ZONE = "America/Chicago";

function datePartsInTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function birthdayMessage(patient, clinicName) {
  const name = patient.name || "";
  const safeName = escapeHtml(name);
  const safeClinic = escapeHtml(clinicName);

  if (patient.language === "Inglés") {
    return {
      subject: `Happy birthday, ${name}!`,
      text: `Happy birthday, ${name}! We hope you have a wonderful day filled with health and happiness. Best wishes from ${clinicName}.`,
      html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.6"><h2 style="color:#0f766e">Happy birthday, ${safeName}!</h2><p>We hope you have a wonderful day filled with health and happiness.</p><p>Best wishes from <strong>${safeClinic}</strong>.</p></div>`
    };
  }

  return {
    subject: `¡Feliz cumpleaños, ${name}!`,
    text: `¡Feliz cumpleaños, ${name}! Esperamos que disfrutes un día maravilloso lleno de salud y alegría. Con cariño, ${clinicName}.`,
    html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.6"><h2 style="color:#0f766e">¡Feliz cumpleaños, ${safeName}!</h2><p>Esperamos que disfrutes un día maravilloso lleno de salud y alegría.</p><p>Con cariño, <strong>${safeClinic}</strong>.</p></div>`
  };
}

exports.sendBirthdayEmails = onSchedule({
  schedule: "0 9 * * *",
  timeZone: TIME_ZONE,
  region: "us-central1",
  retryCount: 1
}, async () => {
  const { year, month, day } = datePartsInTimeZone();
  const birthdaySuffix = `-${month}-${day}`;
  const patients = await db.collectionGroup("patients").get();
  const clinicSettings = new Map();
  let queued = 0;

  for (const patientDoc of patients.docs) {
    const patient = patientDoc.data();
    if (!patient.emailNotificationsEnabled || !patient.birthdayEmailEnabled || !patient.email || !patient.birthDate?.endsWith(birthdaySuffix)) continue;

    const clinicRef = patientDoc.ref.parent.parent;
    if (!clinicRef) continue;

    if (!clinicSettings.has(clinicRef.id)) {
      const settingsDoc = await clinicRef.collection("settings").doc("clinic").get();
      const settings = settingsDoc.data() || {};
      clinicSettings.set(clinicRef.id, {
        clinicName: settings.clinicName || "Clinic Control",
        senderEmail: settings.senderEmail || settings.clinicEmail || ""
      });
    }

    const mailId = `birthday_${clinicRef.id}_${patientDoc.id}_${year}`;
    const mailRef = db.collection("mail").doc(mailId);
    const clinic = clinicSettings.get(clinicRef.id);
    const message = {
      ...birthdayMessage(patient, clinic.clinicName),
      ...(clinic.senderEmail ? {
        from: `${clinic.clinicName} <${clinic.senderEmail}>`,
        replyTo: clinic.senderEmail
      } : {})
    };

    const created = await db.runTransaction(async (transaction) => {
      if ((await transaction.get(mailRef)).exists) return false;
      transaction.create(mailRef, {
        to: [patient.email],
        message,
        metadata: {
          type: "birthday",
          clinicId: clinicRef.id,
          patientId: patientDoc.id,
          language: patient.language || "Español",
          year
        },
        createdAt: FieldValue.serverTimestamp()
      });
      return true;
    });

    if (created) queued += 1;
  }

  logger.info("Birthday email check completed", { patients: patients.size, queued, date: `${year}-${month}-${day}` });
});
