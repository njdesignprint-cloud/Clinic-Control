const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

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

function portalCors(response) {
  response.set("Access-Control-Allow-Origin", "https://njdesignprint-cloud.github.io");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function portalCode() { return crypto.randomBytes(6).toString("base64url").toUpperCase(); }
function portalKey(code = "") { return crypto.createHash("sha256").update(String(code).trim().toUpperCase()).digest("hex"); }
function portalExpired(session) { return !session || session.status !== "active" || !session.expiresAt || session.expiresAt.toMillis() <= Date.now(); }

async function requireClinicUser(request, clinicId) {
  const bearer = request.headers.authorization || "";
  if (!bearer.startsWith("Bearer ")) throw new Error("unauthenticated");
  const decoded = await getAuth().verifyIdToken(bearer.slice(7));
  if (decoded.uid === clinicId) return decoded;
  const profile = await db.collection("userProfiles").doc(decoded.uid).get();
  const data = profile.data();
  if (!profile.exists || data.clinicId !== clinicId || data.status !== "active" || !["admin", "reception", "clinical"].includes(data.role)) throw new Error("forbidden");
  return decoded;
}

async function loadPortalSession(code) {
  const ref = db.collection("patientPortalSessions").doc(portalKey(code));
  const snap = await ref.get(); const session = snap.data();
  if (!snap.exists || portalExpired(session)) throw new Error("invalid-session");
  return { ref, session };
}

exports.patientPortal = onRequest({ region: "us-central1", cors: false, timeoutSeconds: 30, invoker: "public" }, async (request, response) => {
  portalCors(response);
  if (request.method === "OPTIONS") return response.status(204).send("");
  if (request.method !== "POST") return response.status(405).json({ error: "method-not-allowed" });
  try {
    const action = request.body?.action;
    if (action === "create") {
      const { clinicId, roomId, patientId, activities = [], language = "es", completionAction = "ready" } = request.body;
      const user = await requireClinicUser(request, clinicId);
      const [roomSnap, patientSnap] = await Promise.all([db.doc(`clinics/${clinicId}/rooms/${roomId}`).get(), db.doc(`clinics/${clinicId}/patients/${patientId}`).get()]);
      if (!roomSnap.exists || roomSnap.data().patientId !== patientId || !patientSnap.exists) throw new Error("invalid-room");
      const safeActivities = [];
      for (const item of activities.slice(0, 20)) {
        if (item.type === "form") {
          const snap = await db.doc(`clinics/${clinicId}/formResponses/${item.responseId}`).get();
          if (snap.exists && snap.data().patientId === patientId && snap.data().status !== "completed") safeActivities.push({ type: "form", responseId: item.responseId });
        }
        if (item.type === "document") {
          const snap = await db.doc(`clinics/${clinicId}/visits/${item.visitId}`).get(); const doc = (snap.data()?.documents || []).find((entry) => entry.documentId === item.documentId && entry.status !== "signed");
          if (snap.exists && snap.data().patientId === patientId && doc) safeActivities.push({ type: "document", visitId: item.visitId, documentId: item.documentId });
        }
      }
      const code = portalCode(); const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await db.collection("patientPortalSessions").doc(portalKey(code)).set({ clinicId, roomId, patientId, activities: safeActivities, language, completionAction, currentIndex: 0, status: "active", createdBy: user.uid, createdAt: FieldValue.serverTimestamp(), expiresAt });
      await roomSnap.ref.set({ status: roomSnap.data().status === "waiting" ? "nursing" : roomSnap.data().status, portalActive: true, portalExpiresAt: expiresAt, updatedAt: new Date().toISOString() }, { merge: true });
      return response.json({ code, expiresAt: expiresAt.toISOString(), portalUrl: "https://njdesignprint-cloud.github.io/Clinic-Control/patient.html" });
    }

    const { ref, session } = await loadPortalSession(request.body?.code);
    const clinic = db.collection("clinics").doc(session.clinicId);
    if (action === "get") {
      const [patientSnap, settingsSnap, roomSnap] = await Promise.all([clinic.collection("patients").doc(session.patientId).get(), clinic.collection("settings").doc("clinic").get(), clinic.collection("rooms").doc(session.roomId).get()]);
      const activities = [];
      for (const item of session.activities || []) {
        if (item.type === "form") { const snap = await clinic.collection("formResponses").doc(item.responseId).get(); const data = snap.data(); if (snap.exists) activities.push({ type: "form", responseId: item.responseId, title: data.templateName || "Formulario", description: data.description || "", questions: data.questions || [], answers: data.answers || {} }); }
        if (item.type === "document") { const snap = await clinic.collection("visits").doc(item.visitId).get(); const doc = (snap.data()?.documents || []).find((entry) => entry.documentId === item.documentId); if (doc) activities.push({ type: "document", visitId: item.visitId, documentId: item.documentId, title: doc.name || "Documento", url: doc.url || "", fields: doc.fields || [], answers: doc.answers || {} }); }
      }
      return response.json({ clinicName: settingsSnap.data()?.clinicName || "Clinic Control", roomName: roomSnap.data()?.name || "Room", firstName: (patientSnap.data()?.name || "").split(" ")[0], language: session.language, currentIndex: session.currentIndex || 0, activities, expiresAt: session.expiresAt.toDate().toISOString() });
    }
    if (action === "submitForm") {
      const item = (session.activities || [])[session.currentIndex || 0]; if (item?.type !== "form" || item.responseId !== request.body.responseId) throw new Error("invalid-activity");
      const formRef = clinic.collection("formResponses").doc(item.responseId); const snap = await formRef.get(); const form = snap.data();
      const answers = request.body.answers || {}; const missing = (form.questions || []).find((q) => q.required && !String(answers[q.id] || "").trim()); if (missing) return response.status(400).json({ error: "required", label: missing.label });
      await formRef.set({ answers, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedBy: "patient-portal", roomId: session.roomId }, { merge: true });
      await ref.update({ currentIndex: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }); return response.json({ ok: true });
    }
    if (action === "signDocument") {
      const item = (session.activities || [])[session.currentIndex || 0]; if (item?.type !== "document" || item.visitId !== request.body.visitId || item.documentId !== request.body.documentId || request.body.consent !== true) throw new Error("invalid-activity");
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(request.body.signature || ""); if (!match || match[1].length > 2000000) throw new Error("invalid-signature"); const signedBy = String(request.body.signedBy || "").trim().slice(0, 160); if (!signedBy) throw new Error("signer-required");
      const visitRef = clinic.collection("visits").doc(item.visitId); const snap = await visitRef.get(); const visit = snap.data(); const doc = (visit.documents || []).find((entry) => entry.documentId === item.documentId); if (!doc || visit.patientId !== session.patientId) throw new Error("invalid-document");
      const answers = request.body.answers || {}; const missing = (doc.fields || []).find((field) => field.required && !String(answers[field.id] || "").trim()); if (missing) return response.status(400).json({ error: "required", label: missing.label });
      const token = crypto.randomUUID(); const path = `clinics/${session.clinicId}/signatures/${item.visitId}/${item.documentId}/${token}.png`; const file = getStorage().bucket().file(path); await file.save(Buffer.from(match[1], "base64"), { metadata: { contentType: "image/png", metadata: { firebaseStorageDownloadTokens: token } } });
      const signatureUrl = `https://firebasestorage.googleapis.com/v0/b/${getStorage().bucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`; const signedAt = new Date().toISOString();
      const documents = visit.documents.map((entry) => entry.documentId === item.documentId ? { ...entry, answers, status: "signed", signedBy, signedAt, signatureUrl, signaturePath: path, consentAccepted: true, signedInRoomId: session.roomId } : entry); await visitRef.update({ documents, updatedAt: signedAt }); await ref.update({ currentIndex: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }); return response.json({ ok: true });
    }
    if (action === "complete") {
      await ref.update({ status: "completed", completedAt: FieldValue.serverTimestamp() }); await clinic.collection("rooms").doc(session.roomId).set({ status: session.completionAction || "ready", portalActive: false, portalExpiresAt: null, updatedAt: new Date().toISOString() }, { merge: true }); return response.json({ ok: true });
    }
    return response.status(400).json({ error: "unknown-action" });
  } catch (error) {
    logger.warn("Patient portal request rejected", { action: request.body?.action, message: error.message });
    const status = ["unauthenticated", "forbidden"].includes(error.message) ? 403 : ["invalid-session"].includes(error.message) ? 410 : 400;
    return response.status(status).json({ error: error.message });
  }
});
