let state = { settings: {}, patients: [], visits: [], appointments: [], payments: [], documents: [] };
let firestore = null;
let auth = null;
let storage = null;
let unsubscribeSettings = null;
let unsubscribePatients = null;
let unsubscribeVisits = null;
let unsubscribeAppointments = null;
let unsubscribePayments = null;
let unsubscribeDocuments = null;
let activeInvoiceId = null;
let activeBillingTab = "all";
let activeFinancePatientId = null;
let pendingAppointmentId = null;
let activeSignatureVisitId = null;
let activeSignatureDocumentId = null;
let signatureHasInk = false;
let appointmentView = localStorage.getItem("clinicAppointmentView") || "day";
let currentBillingRows = [];

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildSeedState() {
  return {
    settings: {
      clinicName: "",
      clinicAddress: "",
      clinicPhone: "",
      clinicEmail: "",
      clinicLogo: "",
      invoicePrefix: "FAC",
      invoiceAccentColor: "#0f766e",
      invoiceLogoPosition: "left",
      invoiceFooter: "Gracias por confiar en nuestra clínica.",
      invoiceShowAddress: true,
      invoiceShowPhone: true,
      invoiceShowEmail: true,
      invoiceShowDoctor: true,
      invoiceShowInsurance: true
    },
    patients: [],
    visits: [],
    appointments: [],
    payments: []
  };
}

function normalizeState(saved) {
  const seed = buildSeedState();
  return {
    settings: {
      clinicName: saved?.settings?.clinicName || seed.settings.clinicName,
      clinicAddress: saved?.settings?.clinicAddress || seed.settings.clinicAddress,
      clinicPhone: saved?.settings?.clinicPhone || seed.settings.clinicPhone,
      clinicEmail: saved?.settings?.clinicEmail || seed.settings.clinicEmail,
      clinicLogo: saved?.settings?.clinicLogo || seed.settings.clinicLogo,
      invoicePrefix: saved?.settings?.invoicePrefix || seed.settings.invoicePrefix,
      invoiceAccentColor: saved?.settings?.invoiceAccentColor || seed.settings.invoiceAccentColor,
      invoiceLogoPosition: saved?.settings?.invoiceLogoPosition || seed.settings.invoiceLogoPosition,
      invoiceFooter: saved?.settings?.invoiceFooter ?? seed.settings.invoiceFooter,
      invoiceShowAddress: saved?.settings?.invoiceShowAddress ?? seed.settings.invoiceShowAddress,
      invoiceShowPhone: saved?.settings?.invoiceShowPhone ?? seed.settings.invoiceShowPhone,
      invoiceShowEmail: saved?.settings?.invoiceShowEmail ?? seed.settings.invoiceShowEmail,
      invoiceShowDoctor: saved?.settings?.invoiceShowDoctor ?? seed.settings.invoiceShowDoctor,
      invoiceShowInsurance: saved?.settings?.invoiceShowInsurance ?? seed.settings.invoiceShowInsurance
    },
    patients: Array.isArray(saved?.patients) ? saved.patients : seed.patients,
    visits: Array.isArray(saved?.visits) ? saved.visits : seed.visits,
    appointments: Array.isArray(saved?.appointments) ? saved.appointments : seed.appointments,
    payments: Array.isArray(saved?.payments) ? saved.payments : seed.payments
  };
}

function initFirebase() {
  if (!window.firebaseConfig || !window.firebase) {
    throw new Error("Firebase no está configurado.");
  }

  // Evita volver a configurar Firestore en cada intento de acceso.
  if (firestore && auth) {
    return { firestore, auth };
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(window.firebaseConfig);
  }

  firestore = firebase.firestore();
  auth = firebase.auth();

  firestore.enablePersistence({ synchronizeTabs: true }).catch((error) => {
    console.warn("Persistencia offline no disponible:", error);
  });

  storage = firebase.storage();
  return { firestore, auth, storage };
}

function getAuthErrorMessage(error, action = "login") {
  const messages = {
    "auth/email-already-in-use": "Ya existe una cuenta con este correo.",
    "auth/invalid-email": "El correo electrónico no es válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/operation-not-allowed": "El registro con correo y contraseña no está habilitado en Firebase.",
    "auth/network-request-failed": "No se pudo conectar con Firebase. Revisa tu conexión.",
    "auth/too-many-requests": "Se hicieron demasiados intentos. Espera un momento e inténtalo de nuevo.",
    "auth/invalid-credential": "El correo o la contraseña son incorrectos.",
    "auth/user-disabled": "Esta cuenta está deshabilitada."
  };

  return messages[error?.code]
    || error?.message
    || (action === "register"
      ? "No se pudo crear la cuenta. Revisa los datos."
      : "No se pudo iniciar sesión. Verifica tus datos.");
}

async function ensureAuth() {
  if (!auth) {
    initFirebase();
  }

  if (!auth.currentUser) {
    throw new Error("Usuario no autenticado");
  }
}

function getClinicDocRef() {
  if (!firestore) {
    initFirebase();
  }

  if (!auth || !auth.currentUser) {
    throw new Error("Usuario no autenticado");
  }

  return firestore.collection("clinics").doc(auth.currentUser.uid);
}

function getCollectionRef(collectionName) {
  return getClinicDocRef().collection(collectionName);
}

function unsubscribeAll() {
  if (unsubscribeSettings) unsubscribeSettings();
  if (unsubscribePatients) unsubscribePatients();
  if (unsubscribeVisits) unsubscribeVisits();
  if (unsubscribeAppointments) unsubscribeAppointments();
  if (unsubscribePayments) unsubscribePayments();
  if (unsubscribeDocuments) unsubscribeDocuments();
  unsubscribeSettings = null;
  unsubscribePatients = null;
  unsubscribeVisits = null;
  unsubscribeAppointments = null;
  unsubscribePayments = null;
  unsubscribeDocuments = null;
}

function showAuthScreen() {
  $("#authScreen").classList.remove("hidden");
  document.querySelector(".app-shell").classList.add("hidden");
  showAuthForm("login");
}

function showAppScreen() {
  $("#authScreen").classList.add("hidden");
  document.querySelector(".app-shell").classList.remove("hidden");
}

function clearState() {
  state = { settings: {}, patients: [], visits: [], appointments: [], payments: [], documents: [] };
  render();
}

function subscribeToRealtime() {
  unsubscribeAll();

  const settingsRef = getClinicDocRef().collection("settings").doc("clinic");
  const patientsRef = getCollectionRef("patients");
  const visitsRef = getCollectionRef("visits");
  const appointmentsRef = getCollectionRef("appointments");
  const paymentsRef = getCollectionRef("payments");
  const documentsRef = getCollectionRef("documents");

  unsubscribeSettings = settingsRef.onSnapshot((doc) => {
    if (doc.exists) {
      state.settings = doc.data() || {};
      render();
    }
  });

  unsubscribePatients = patientsRef.onSnapshot((snapshot) => {
    state.patients = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    render();
  });

  unsubscribeVisits = visitsRef.onSnapshot((snapshot) => {
    state.visits = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    render();
    if ($("#visitDialog")?.classList.contains("active") && $("#visitId")?.value) renderVisitPaymentPanel(state.visits.find((visit) => visit.id === $("#visitId").value));
  });
  unsubscribeAppointments = appointmentsRef.onSnapshot((snapshot) => {
    state.appointments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    render();
  });
  unsubscribePayments = paymentsRef.onSnapshot((snapshot) => {
    state.payments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    render();
    if ($("#visitDialog")?.classList.contains("active") && $("#visitId")?.value) renderVisitPaymentPanel(state.visits.find((visit) => visit.id === $("#visitId").value));
  });
  unsubscribeDocuments = documentsRef.orderBy("createdAt", "desc").onSnapshot((snapshot) => {
    state.documents = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderSettings();
  });
}

async function removeLegacyDemoData(settingsDoc, patientsSnap, visitsSnap) {
  const demoPatients = new Map([
    ["P-1001", "Oscar Arrate Fernandez"],
    ["P-1002", "Maria Perez"],
    ["P-1003", "Pedro Perez Garcia"]
  ]);
  const demoPatientDocs = patientsSnap.docs.filter((doc) => {
    const data = doc.data();
    return demoPatients.get(data.document) === data.name;
  });
  const demoPatientIds = new Set(demoPatientDocs.map((doc) => doc.id));
  const demoVisitDocs = visitsSnap.docs.filter((doc) => demoPatientIds.has(doc.data().patientId));
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  const hasDemoSettings = settings.clinicName === "Clinic Control"
    && settings.clinicAddress === "Dirección de la clínica"
    && settings.clinicPhone === "(000) 000-0000"
    && settings.clinicEmail === "admin@clinic.com";

  if (!demoPatientDocs.length && !demoVisitDocs.length && !hasDemoSettings) return false;

  const batch = firestore.batch();
  demoPatientDocs.forEach((doc) => batch.delete(doc.ref));
  demoVisitDocs.forEach((doc) => batch.delete(doc.ref));
  if (hasDemoSettings) batch.delete(settingsDoc.ref);
  await batch.commit();
  return true;
}

async function loadClinicData() {
  await ensureAuth();

  const settingsRef = getClinicDocRef().collection("settings").doc("clinic");
  const patientsRef = getCollectionRef("patients");
  const visitsRef = getCollectionRef("visits");

  const [settingsDoc, patientsSnap, visitsSnap] = await Promise.all([
    settingsRef.get(),
    patientsRef.get(),
    visitsRef.get()
  ]);

  if (await removeLegacyDemoData(settingsDoc, patientsSnap, visitsSnap)) {
    state = buildSeedState();
    subscribeToRealtime();
    render();
    return;
  }

  if (!settingsDoc.exists && patientsSnap.empty && visitsSnap.empty) {
    state = buildSeedState();
    subscribeToRealtime();
    render();
    return;
  }

  state = normalizeState({
    settings: settingsDoc.exists ? settingsDoc.data() : {},
    patients: patientsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    visits: visitsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  });

  subscribeToRealtime();
  render();
}

async function save() {
  await ensureAuth();
  await getClinicDocRef().collection("settings").doc("clinic").set(state.settings, { merge: true });
}

async function savePatient(data) {
  await ensureAuth();
  await getCollectionRef("patients").doc(data.id).set({ ...data }, { merge: true });
}

async function saveVisit(data) {
  await ensureAuth();
  await getCollectionRef("visits").doc(data.id).set({ ...data }, { merge: true });
}

async function saveAppointment(data) {
  await ensureAuth();
  await getCollectionRef("appointments").doc(data.id).set({ ...data }, { merge: true });
}

async function deleteAppointmentEntry(id) {
  await ensureAuth();
  await getCollectionRef("appointments").doc(id).delete();
}

async function registerPayment(data, visit) {
  await ensureAuth();
  const sourceField = data.source === "insurance" ? "insurancePaid" : "patientPaid";
  const currentPatientPaid = visit.patientPaid !== undefined ? Number(visit.patientPaid || 0) : (paymentType(visit) === "cash" ? Number(visit.paid || 0) : 0);
  const currentInsurancePaid = visit.insurancePaid !== undefined ? Number(visit.insurancePaid || 0) : (paymentType(visit) === "insurance" ? Number(visit.paid || 0) : 0);
  const updatedPatientPaid = sourceField === "patientPaid" ? currentPatientPaid + data.amount : currentPatientPaid;
  const updatedInsurancePaid = sourceField === "insurancePaid" ? currentInsurancePaid + data.amount : currentInsurancePaid;
  const batch = firestore.batch();
  batch.set(getCollectionRef("payments").doc(data.id), data);
  batch.set(getCollectionRef("visits").doc(visit.id), {
    patientPaid: updatedPatientPaid,
    insurancePaid: updatedInsurancePaid,
    paid: updatedPatientPaid + updatedInsurancePaid
  }, { merge: true });
  await batch.commit();
}

async function saveSettings() {
  await ensureAuth();
  await getClinicDocRef().collection("settings").doc("clinic").set(state.settings, { merge: true });
}

async function uploadClinicDocument(file) {
  await ensureAuth();
  if (!file) return;
  const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg"];
  if (!allowed.includes(file.type)) throw new Error(`${file.name}: formato no permitido.`);
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: supera el máximo de 10 MB.`);
  const id = uid();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `clinics/${auth.currentUser.uid}/documents/${id}/${safeName}`;
  const ref = storage.ref(path);
  await ref.put(file, { contentType: file.type });
  const url = await ref.getDownloadURL();
  await getCollectionRef("documents").doc(id).set({ id, name: file.name, type: file.type, size: file.size, path, url, createdAt: new Date().toISOString() });
}

async function deleteClinicDocument(id) {
  const documentItem = state.documents.find((item) => item.id === id);
  if (!documentItem || !confirm(`¿Eliminar ${documentItem.name}?`)) return;
  try {
    if (documentItem.path) await storage.ref(documentItem.path).delete().catch((error) => {
      if (error.code !== "storage/object-not-found") throw error;
    });
    await getCollectionRef("documents").doc(id).delete();
    toast("Documento eliminado");
  } catch (error) {
    console.error(error);
    toast("No se pudo eliminar el documento");
  }
}

async function deletePatientEntry(id) {
  await ensureAuth();
  const visitSnap = await getCollectionRef("visits").where("patientId", "==", id).get();
  const appointmentSnap = await getCollectionRef("appointments").where("patientId", "==", id).get();
  const paymentSnap = await getCollectionRef("payments").where("patientId", "==", id).get();
  const batch = firestore.batch();
  batch.delete(getCollectionRef("patients").doc(id));
  visitSnap.docs.forEach((doc) => batch.delete(getCollectionRef("visits").doc(doc.id)));
  appointmentSnap.docs.forEach((doc) => batch.delete(doc.ref));
  paymentSnap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function deleteVisitEntry(id) {
  await ensureAuth();
  await getCollectionRef("visits").doc(id).delete();
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function money(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function invoiceNumber(visit) {
  const prefix = state.settings.invoicePrefix || "FAC";
  return visit.invoiceNumber || `${prefix}-${String(visit.id || "").slice(0, 8).toUpperCase()}`;
}

function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return reject(new Error("Formato de logo no válido."));
    if (file.size > 350 * 1024) return reject(new Error("El logo debe pesar 350 KB o menos."));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el logo."));
    reader.readAsDataURL(file);
  });
}

function invoiceSettings() {
  return {
    accent: state.settings.invoiceAccentColor || "#0f766e",
    logoPosition: state.settings.invoiceLogoPosition || "left",
    footer: state.settings.invoiceFooter || "",
    showAddress: state.settings.invoiceShowAddress !== false,
    showPhone: state.settings.invoiceShowPhone !== false,
    showEmail: state.settings.invoiceShowEmail !== false,
    showDoctor: state.settings.invoiceShowDoctor !== false,
    showInsurance: state.settings.invoiceShowInsurance !== false
  };
}

function visitItems(visit) {
  if (Array.isArray(visit?.lineItems) && visit.lineItems.length) return visit.lineItems.map((item) => ({
    ...item,
    quantity: Number(item.quantity || 1),
    unitPrice: Number(item.unitPrice ?? item.price ?? 0),
    price: Number(item.price ?? (Number(item.quantity || 1) * Number(item.unitPrice || 0)))
  }));
  if (Number(visit?.total || 0) > 0) {
    return [{ id: uid(), description: visit.reason || "Consulta", quantity: 1, unitPrice: Number(visit.total), price: Number(visit.total) }];
  }
  return [];
}

function payerLabel(p) {
  return p?.payerType === "insurance"
    ? `Seguro médico${p.insuranceCompany ? ` · ${p.insuranceCompany}` : ""}`
    : "Pago propio";
}

function updateUserInfo() {
  const user = auth.currentUser;
  if (user) {
    $("#userInfo").textContent = `Sesión: ${user.email || user.uid}`;
  } else {
    $("#userInfo").textContent = "";
  }
}

function fmtDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fmtBirthDate(value) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  });
}

function ageFromBirthDate(value) {
  if (!value) return "";
  const birth = new Date(`${value}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday = now.getMonth() < birth.getMonth()
    || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function onlyDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function patient(id) {
  return state.patients.find((item) => item.id === id);
}

function balance(visit) {
  return Math.max(0, Number(visit.total || 0) - totalPaid(visit));
}

function totalPaid(visit) {
  if (visit.patientPaid !== undefined || visit.insurancePaid !== undefined) {
    return Number(visit.patientPaid || 0) + Number(visit.insurancePaid || 0);
  }
  return Number(visit.paid || 0);
}

function paymentType(visit) {
  return visit.paymentType || (patient(visit.patientId)?.payerType === "insurance" ? "insurance" : "cash");
}

function financialStatus(visit) {
  if (visit.claimStatus === "rejected") return { key: "rejected", label: "Rechazada", color: "red" };
  const paid = totalPaid(visit);
  if (balance(visit) <= 0) return { key: "paid", label: "Pagado", color: "green" };
  if (paid > 0) return { key: "partial", label: "Pago parcial", color: "blue" };
  return { key: "pending", label: "Pendiente", color: "red" };
}

const appointmentStatuses = {
  scheduled: { label: "Programada", color: "blue" },
  confirmed: { label: "Confirmada", color: "green" },
  arrived: { label: "En espera", color: "orange" },
  completed: { label: "Atendida", color: "green" },
  cancelled: { label: "Cancelada", color: "red" },
  no_show: { label: "No asistió", color: "red" }
};

function appointmentStatus(value) {
  return appointmentStatuses[value] || appointmentStatuses.scheduled;
}

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function totals(visits = state.visits) {
  return visits.reduce((acc, visit) => {
    acc.billed += Number(visit.total || 0);
    acc.paid += totalPaid(visit);
    acc.debt += balance(visit);
    return acc;
  }, { billed: 0, paid: 0, debt: 0 });
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2200);
}

function showPage(pageId) {
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === pageId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === (pageId === "visitDialog" ? "visits" : pageId)));

  const labels = {
    dashboard: "Dashboard",
    patients: "Pacientes",
    appointments: "Citas",
    visits: "Consultas",
    billing: "Pagos",
    invoices: "Facturas",
    reports: "Reportes",
    settings: "Ajustes"
  };

  $("#pageTitle").textContent = pageId === "visitDialog" ? "Expediente de consulta" : (labels[pageId] || "Clinic Control");
  render();
}

function render() {
  renderDashboard();
  renderPatients();
  renderAppointments();
  renderVisitOptions();
  renderVisits();
  renderBilling();
  renderInvoicePatientOptions();
  renderInvoices();
  renderReports();
  renderSettings();
}

function renderDashboard() {
  const dayVisits = state.visits.filter((visit) => onlyDate(visit.date) === today());
  const allTotals = totals();
  const dayTotals = totals(dayVisits);
  const balancePatients = debtRows();

  $("#kpiPatients").textContent = state.patients.length;
  $("#kpiPatientsHint").textContent = `${state.patients.length} registros activos`;
  $("#kpiTodayVisits").textContent = dayVisits.length;
  $("#kpiTodayPaid").textContent = money(dayTotals.paid);
  $("#kpiBalance").textContent = money(allTotals.debt);
  $("#kpiBalanceHint").textContent = `${balancePatients.length} paciente(s) con deuda`;

  const presencial = dayVisits.filter((visit) => visit.type === "Presencial").length;
  const tele = dayVisits.filter((visit) => visit.type === "Teleconsulta").length;
  $("#kpiVisitMix").textContent = `${presencial} presenciales · ${tele} teleconsulta`;

  renderTimeline();
  renderMiniDebts();
  renderFinanceBars(allTotals);
}

function renderTimeline() {
  const visits = [...state.visits].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  const box = $("#activityTimeline");

  if (!visits.length) {
    box.innerHTML = `<div class="empty">No hay actividad registrada.</div>`;
    return;
  }

  box.innerHTML = visits.map((visit) => {
    const p = patient(visit.patientId);
    const isPaid = balance(visit) <= 0;
    return `
      <div class="timeline-item">
        <div class="timeline-icon">${visit.type === "Teleconsulta" ? "T" : "P"}</div>
        <div>
          <strong>${p?.name || "Paciente eliminado"}</strong>
          <span>${visit.reason || "Consulta"} · ${fmtDate(visit.date)}</span>
          <div class="timeline-meta">
            <span class="payment-status ${isPaid ? "" : "pending"}">${isPaid ? "Pagado" : "Pago pendiente"}</span>
            <span>${visit.type || "Presencial"}${visit.doctor ? ` · ${visit.doctor}` : ""}</span>
          </div>
        </div>
        <div class="amount">${money(visit.total)}</div>
      </div>
    `;
  }).join("");
}

function debtRows() {
  const map = new Map();

  state.visits.forEach((visit) => {
    const due = balance(visit);
    if (due <= 0) return;

    const p = patient(visit.patientId);
    if (!p) return;

    const row = map.get(p.id) || {
      patient: p,
      debt: 0,
      visits: []
    };

    row.debt += due;
    row.visits.push(visit);
    map.set(p.id, row);
  });

  return [...map.values()].sort((a, b) => b.debt - a.debt);
}

function renderMiniDebts() {
  const rows = debtRows().slice(0, 5);
  const box = $("#balanceMiniList");

  if (!rows.length) {
    box.innerHTML = `<div class="empty">Sin balances pendientes.</div>`;
    return;
  }

  box.innerHTML = rows.map((row) => `
    <div class="mini-row">
      <div>
        <strong>${row.patient.name}</strong>
        <span>${row.visits.length} consulta(s)</span>
      </div>
      <strong>${money(row.debt)}</strong>
    </div>
  `).join("");
}

function renderFinanceBars(data) {
  const max = Math.max(data.billed, data.paid, data.debt, 1);

  $("#financeBilled").textContent = money(data.billed);
  $("#financePaid").textContent = money(data.paid);
  $("#financeDebt").textContent = money(data.debt);

  $("#barBilled").style.width = `${Math.max(4, (data.billed / max) * 100)}%`;
  $("#barPaid").style.width = `${Math.max(4, (data.paid / max) * 100)}%`;
  $("#barDebt").style.width = `${Math.max(4, (data.debt / max) * 100)}%`;
}

function renderPatients() {
  const query = ($("#patientSearch")?.value || "").toLowerCase().trim();
  const rows = state.patients.filter((p) => `${p.name} ${p.phone} ${p.email || ""} ${p.document} ${p.language || ""} ${p.notes || ""} ${p.insuranceCompany || ""} ${p.insuranceMemberId || ""} ${p.insuranceGroup || ""}`.toLowerCase().includes(query));

  $("#patientsTable").innerHTML = rows.length ? rows.map((p) => `
    <tr>
      <td><strong>${p.name}</strong><br><small>${p.notes || "Sin notas"}</small><br><span class="badge ${p.payerType === "insurance" ? "blue" : "green"}">${escapeHtml(payerLabel(p))}</span></td>
      <td>${p.phone || "-"}<br><small>${p.email || "Sin correo"}</small></td>
      <td>${fmtBirthDate(p.birthDate)}<br><small>${p.age !== "" && p.age != null ? `${p.age} años` : "Edad no indicada"}</small></td>
      <td><span class="badge blue">${p.language || "No indicado"}</span></td>
      <td>${p.document || "-"}</td>
      <td>${fmtDate(p.createdAt)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" onclick="editPatient('${p.id}')" title="Editar">✎</button>
          <button class="icon-btn finance-patient-btn" onclick="openPatientFinance('${p.id}')" title="Ver cuenta">$</button>
          <button class="icon-btn" onclick="deletePatient('${p.id}')" title="Eliminar">⌫</button>
        </div>
      </td>
    </tr>
  `).join("") : `<tr><td class="empty" colspan="7">No se encontraron pacientes.</td></tr>`;
}

function renderVisitOptions() {
  const selectedVisitPatient = $("#visitPatient").value;
  const selectedAppointmentPatient = $("#appointmentPatient")?.value;
  $("#visitPatient").innerHTML = state.patients.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  if ($("#appointmentPatient")) $("#appointmentPatient").innerHTML = state.patients.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (state.patients.some((p) => p.id === selectedVisitPatient)) $("#visitPatient").value = selectedVisitPatient;
  if (selectedAppointmentPatient && state.patients.some((p) => p.id === selectedAppointmentPatient)) $("#appointmentPatient").value = selectedAppointmentPatient;
  renderAppointmentDoctorOptions();
}

function appointmentDoctors() {
  return [...new Set([...state.appointments, ...state.visits].map((item) => String(item.doctor || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function renderAppointmentDoctorOptions() {
  const doctors = appointmentDoctors();
  const datalist = $("#appointmentDoctorOptions");
  if (datalist) datalist.innerHTML = doctors.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  const filter = $("#appointmentDoctorFilter");
  if (!filter) return;
  const selected = filter.value;
  filter.innerHTML = `<option value="">Todos los profesionales</option>${doctors.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (doctors.includes(selected)) filter.value = selected;
}

function startOfAppointmentWeek(value) {
  const date = new Date(`${value}T12:00:00`);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

function addLocalDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function appointmentMatchesFilters(item, query, statusFilter, doctorFilter) {
  const p = patient(item.patientId);
  if (statusFilter && item.status !== statusFilter) return false;
  if (doctorFilter && item.doctor !== doctorFilter) return false;
  return `${p?.name || ""} ${item.doctor || ""} ${item.reason || ""}`.toLowerCase().includes(query);
}

function appointmentCardContent(item, compact = false) {
  const p = patient(item.patientId);
  const status = appointmentStatus(item.status);
  const time = new Date(item.date).toLocaleTimeString("es-US", { hour: "2-digit", minute: "2-digit" });
  if (compact) return `<button type="button" class="calendar-event status-${item.status}" onclick="event.stopPropagation(); editAppointment('${item.id}')" title="${escapeHtml(`${time} · ${p?.name || "Paciente"} · ${item.reason || "Cita"}`)}"><strong>${time} ${escapeHtml(p?.name || "Paciente")}</strong><span>${escapeHtml(item.reason || "Cita")} · ${item.duration || 30} min</span></button>`;
  return `<article class="appointment-card status-${item.status}">
    <div class="appointment-time"><strong>${time}</strong><span>${item.duration || 30} min</span></div>
    <div class="appointment-main"><div><h3>${escapeHtml(p?.name || "Paciente eliminado")}</h3><p>${escapeHtml(item.reason || "Sin motivo")}</p></div><span class="badge ${status.color}">${status.label}</span><div class="appointment-meta"><span>${escapeHtml(item.type || "Presencial")}</span><span>${escapeHtml(item.doctor || "Sin profesional")}</span><span>${escapeHtml(p?.phone || "Sin teléfono")}</span></div></div>
    <div class="appointment-actions">
      ${item.status === "scheduled" ? `<button class="btn light" onclick="setAppointmentStatus('${item.id}','confirmed')">Confirmar</button>` : ""}
      ${["scheduled", "confirmed"].includes(item.status) ? `<button class="btn light" onclick="setAppointmentStatus('${item.id}','arrived')">Llegó</button>` : ""}
      ${!["completed", "cancelled", "no_show"].includes(item.status) ? `<button class="btn primary" onclick="startAppointmentVisit('${item.id}')">Iniciar consulta</button>` : ""}
      <button class="icon-btn" onclick="editAppointment('${item.id}')" title="Editar">✎</button>
      ${!["completed", "cancelled"].includes(item.status) ? `<button class="icon-btn danger-icon" onclick="cancelAppointment('${item.id}')" title="Cancelar cita">×</button>` : ""}
    </div></article>`;
}

function renderDayCalendar(rows, dateValue) {
  const active = rows.filter((item) => !["cancelled", "no_show"].includes(item.status));
  const hours = Array.from({ length: 14 }, (_, index) => index + 7);
  return `<div class="day-calendar"><div class="calendar-day-title"><strong>${new Date(`${dateValue}T12:00:00`).toLocaleDateString("es-US", { weekday: "long", day: "numeric", month: "long" })}</strong><span>${active.length} cita(s) activa(s)</span></div>${hours.map((hour) => {
    const slots = [0, 30].map((minute) => {
      const slotItems = rows.filter((item) => { const date = new Date(item.date); return date.getHours() === hour && date.getMinutes() >= minute && date.getMinutes() < minute + 30; });
      const stamp = `${dateValue}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      return `<div class="calendar-slot" onclick="openAppointmentAt('${stamp}')">${slotItems.map((item) => appointmentCardContent(item, true)).join("")}</div>`;
    }).join("");
    return `<div class="calendar-hour"><time>${new Date(`${dateValue}T${String(hour).padStart(2, "0")}:00`).toLocaleTimeString("es-US", { hour: "numeric" })}</time><div>${slots}</div></div>`;
  }).join("")}</div>`;
}

function renderWeekCalendar(rows, dateValue) {
  const monday = startOfAppointmentWeek(dateValue);
  const days = Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
  return `<div class="week-calendar">${days.map((date) => {
    const key = localDateValue(date);
    const items = rows.filter((item) => String(item.date || "").slice(0, 10) === key).sort((a, b) => new Date(a.date) - new Date(b.date));
    return `<section class="week-day ${key === localDateValue() ? "today" : ""}"><button type="button" class="week-day-head" onclick="showAppointmentDay('${key}')"><span>${date.toLocaleDateString("es-US", { weekday: "short" })}</span><strong>${date.getDate()}</strong></button><div class="week-day-body">${items.length ? items.map((item) => appointmentCardContent(item, true)).join("") : `<button type="button" class="week-empty" onclick="openAppointmentAt('${key}T09:00')">+ Agregar</button>`}</div></section>`;
  }).join("")}</div>`;
}

function renderAppointments() {
  const agenda = $("#appointmentAgenda");
  if (!agenda) return;
  const dateValue = $("#appointmentDateFilter").value || localDateValue();
  if (!$("#appointmentDateFilter").value) $("#appointmentDateFilter").value = dateValue;
  const query = ($("#appointmentSearch").value || "").toLowerCase().trim();
  const statusFilter = $("#appointmentStatusFilter").value;
  const doctorFilter = $("#appointmentDoctorFilter")?.value || "";
  renderAppointmentDoctorOptions();
  $$('[data-appointment-view]').forEach((button) => button.classList.toggle("active", button.dataset.appointmentView === appointmentView));
  const filteredRows = [...state.appointments].filter((item) => appointmentMatchesFilters(item, query, statusFilter, doctorFilter));
  const dayRows = filteredRows.filter((item) => String(item.date || "").slice(0, 10) === dateValue).sort((a, b) => new Date(a.date) - new Date(b.date));
  const allDay = state.appointments.filter((item) => String(item.date || "").slice(0, 10) === dateValue);
  const countBy = (status) => allDay.filter((item) => item.status === status).length;
  $("#appointmentSummary").innerHTML = `
    <div><strong>${allDay.length}</strong><span>Total</span></div><div><strong>${countBy("confirmed")}</strong><span>Confirmadas</span></div><div><strong>${countBy("arrived")}</strong><span>En espera</span></div><div><strong>${countBy("completed")}</strong><span>Atendidas</span></div>`;
  if (appointmentView === "day") agenda.innerHTML = renderDayCalendar(dayRows, dateValue);
  else if (appointmentView === "week") agenda.innerHTML = renderWeekCalendar(filteredRows, dateValue);
  else agenda.innerHTML = dayRows.length ? dayRows.map((item) => appointmentCardContent(item)).join("") : `<div class="empty agenda-empty"><strong>Agenda libre</strong><span>No hay citas para esta fecha y filtros.</span><button class="btn primary" onclick="openAppointmentDialog()">Crear una cita</button></div>`;
}

function renderVisits() {
  const query = ($("#visitSearch")?.value || "").toLowerCase().trim();

  const rows = [...state.visits]
    .filter((visit) => {
      const p = patient(visit.patientId);
      return `${p?.name || ""} ${visit.reason} ${visit.doctor} ${visit.type}`.toLowerCase().includes(query);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  $("#visitsTable").innerHTML = rows.length ? rows.map((visit) => {
    const p = patient(visit.patientId);
    const due = balance(visit);
    const visitDocuments = visit.documents || [];
    const pendingDocuments = visitDocuments.filter((item) => item.status !== "signed").length;
    return `
      <tr>
        <td>${fmtDate(visit.date)}</td>
        <td><strong>${p?.name || "Paciente eliminado"}</strong><br><small>${visit.doctor || "Sin doctor asignado"}</small></td>
        <td><span class="badge ${visit.type === "Teleconsulta" ? "blue" : "green"}">${visit.type}</span><br><small>${visit.status || "Completada"}</small></td>
        <td>${visit.reason}</td>
        <td>${money(visit.total)}</td>
        <td>${money(totalPaid(visit))}</td>
        <td><span class="badge ${due > 0 ? "red" : "green"}">${money(due)}</span></td>
        <td>
          <div class="row-actions">
            ${visitDocuments.length ? `<button class="icon-btn signature-action ${pendingDocuments ? "has-pending" : "all-signed"}" onclick="openSignatureDialog('${visit.id}')" title="${pendingDocuments ? `${pendingDocuments} documento(s) pendiente(s) de firma` : "Documentos firmados"}">✍</button>` : ""}
            <button class="icon-btn" onclick="editVisit('${visit.id}')" title="Editar">✎</button>
            <button class="icon-btn" onclick="deleteVisit('${visit.id}')" title="Eliminar">⌫</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td class="empty" colspan="8">No hay consultas registradas.</td></tr>`;
}

function billingVisitAmounts(visit) {
  const type = paymentType(visit);
  const total = Number(visit.total || 0);
  const patientPaid = visit.patientPaid !== undefined ? Number(visit.patientPaid || 0) : (type === "cash" ? Number(visit.paid || 0) : 0);
  const insurancePaid = Number(visit.insurancePaid || 0);
  const patientExpected = type === "cash" ? total : Math.min(total, Math.max(Number(visit.copay || 0), patientPaid));
  const insuranceExpected = type === "insurance" ? Math.max(0, total - patientExpected) : 0;
  return {
    type, total, patientPaid, insurancePaid, patientExpected, insuranceExpected,
    patientPending: Math.max(0, patientExpected - patientPaid),
    insurancePending: Math.max(0, insuranceExpected - insurancePaid)
  };
}

function billingSummaryCard(label, amount, hint, tone = "") {
  return `<article class="kpi-card billing-kpi ${tone}"><span class="kpi-label">${label}</span><strong>${money(amount)}</strong><small>${hint}</small></article>`;
}

function billingTotals(visits) {
  return visits.reduce((acc, visit) => {
    const value = billingVisitAmounts(visit);
    acc.billed += value.total;
    if (value.type === "cash") acc.cashBilled += value.total;
    else acc.insuranceBilled += value.total;
    acc.patientPaid += value.patientPaid;
    acc.insurancePaid += value.insurancePaid;
    acc.patientPending += value.patientPending;
    acc.insurancePending += value.insurancePending;
    return acc;
  }, { billed: 0, cashBilled: 0, insuranceBilled: 0, patientPaid: 0, insurancePaid: 0, patientPending: 0, insurancePending: 0 });
}

function renderBillingSummary(visits) {
  const totals = billingTotals(visits);
  const pending = totals.patientPending + totals.insurancePending;
  let cards = "";
  if (activeBillingTab === "cash") {
    cards = billingSummaryCard("Facturado Cash", totals.cashBilled, "Responsabilidad de pacientes", "tone-cash")
      + billingSummaryCard("Cobrado Cash", totals.patientPaid, "Efectivo, tarjeta y copagos", "tone-paid")
      + billingSummaryCard("Balance de pacientes", totals.patientPending, "Pendiente por cobrar", "tone-pending");
  } else if (activeBillingTab === "insurance") {
    cards = billingSummaryCard("Facturado a seguros", totals.insuranceBilled, "Consultas con cobertura", "tone-insurance")
      + billingSummaryCard("Pagado por seguros", totals.insurancePaid, "Reclamaciones cobradas", "tone-paid")
      + billingSummaryCard("Copagos cobrados", totals.patientPaid, "Pagos del paciente", "tone-cash")
      + billingSummaryCard("Balance de seguros", totals.insurancePending, "Pendiente de aseguradoras", "tone-pending");
  } else if (activeBillingTab === "pending") {
    cards = billingSummaryCard("Balance total", pending, "Todo lo pendiente", "tone-pending")
      + billingSummaryCard("Deben pacientes", totals.patientPending, "Cash y copagos pendientes", "tone-cash")
      + billingSummaryCard("Deben seguros", totals.insurancePending, "Reclamaciones pendientes", "tone-insurance");
  } else {
    cards = billingSummaryCard("Total facturado", totals.billed, "Cash y seguros", "tone-all")
      + billingSummaryCard("Facturado Cash", totals.cashBilled, "Pacientes de pago propio", "tone-cash")
      + billingSummaryCard("Cash cobrado", totals.patientPaid, "Incluye copagos", "tone-paid")
      + billingSummaryCard("Facturado a seguros", totals.insuranceBilled, "Consultas aseguradas", "tone-insurance")
      + billingSummaryCard("Seguros cobrados", totals.insurancePaid, "Pagos recibidos", "tone-paid")
      + billingSummaryCard("Balance total", pending, `Pacientes ${money(totals.patientPending)} · Seguros ${money(totals.insurancePending)}`, "tone-pending");
  }
  $("#billingSummary").className = `kpi-grid billing-summary summary-${activeBillingTab}`;
  $("#billingSummary").innerHTML = cards;
}

function renderBilling() {
  const insuranceSelect = $("#billingInsuranceFilter");
  const selectedInsurance = insuranceSelect.value;
  const insuranceCompanies = [...new Set(state.patients.map((p) => p.insuranceCompany).filter(Boolean))].sort();
  insuranceSelect.innerHTML = `<option value="">Todos los seguros</option>${insuranceCompanies.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (insuranceCompanies.includes(selectedInsurance)) insuranceSelect.value = selectedInsurance;
  const query = ($("#billingSearch")?.value || "").toLowerCase().trim();
  const statusFilter = $("#billingStatusFilter")?.value || "";
  const dateFrom = $("#billingDateFrom")?.value || "";
  const dateTo = $("#billingDateTo")?.value || "";
  const insuranceFilter = $("#billingInsuranceFilter")?.value || "";
  const filteredVisits = [...state.visits].filter((visit) => {
    const p = patient(visit.patientId);
    const status = financialStatus(visit);
    if (statusFilter && status.key !== statusFilter) return false;
    const visitDate = String(visit.date || "").slice(0, 10);
    if (dateFrom && visitDate < dateFrom) return false;
    if (dateTo && visitDate > dateTo) return false;
    if (insuranceFilter && p?.insuranceCompany !== insuranceFilter) return false;
    const searchable = `${p?.name || ""} ${p?.insuranceCompany || ""} ${invoiceNumber(visit)} ${visitItems(visit).map((item) => item.description).join(" ")}`.toLowerCase();
    return searchable.includes(query);
  });
  const rows = filteredVisits.filter((visit) => {
    const type = paymentType(visit);
    if (activeBillingTab === "cash" && type !== "cash") return false;
    if (activeBillingTab === "insurance" && type !== "insurance") return false;
    if (activeBillingTab === "pending" && balance(visit) <= 0) return false;
    return true;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
  currentBillingRows = rows;
  renderBillingSummary(rows);

  $("#billingTable").innerHTML = rows.length ? rows.map((visit) => {
    const p = patient(visit.patientId);
    const type = paymentType(visit);
    const status = financialStatus(visit);
    const patientPaid = visit.patientPaid !== undefined ? Number(visit.patientPaid || 0) : (type === "cash" ? Number(visit.paid || 0) : 0);
    return `<tr><td data-label="Fecha / Factura">${fmtDate(visit.date)}<br><small>${escapeHtml(invoiceNumber(visit))}</small></td><td data-label="Paciente"><strong>${escapeHtml(p?.name || "Paciente eliminado")}</strong><br><small>${escapeHtml(type === "insurance" ? (p?.insuranceCompany || "Seguro no indicado") : "Pago propio")}</small></td><td data-label="Servicios">${visitItems(visit).length} servicio(s)<br><small>${escapeHtml(visitItems(visit).map((item) => item.description).join(", "))}</small></td><td data-label="Tipo"><span class="badge ${type === "insurance" ? "blue" : "green"}">${type === "insurance" ? "Seguro" : "Cash"}</span></td><td data-label="Facturado">${money(visit.total)}</td><td data-label="Paciente">${money(patientPaid)}</td><td data-label="Seguro">${money(visit.insurancePaid)}</td><td data-label="Balance"><strong>${money(balance(visit))}</strong></td><td data-label="Estado"><span class="badge ${status.color}">${status.label}</span></td><td><button class="btn light invoice-view" onclick="openPaymentDialog('${visit.id}')">Registrar pago</button></td></tr>`;
  }).join("") : `<tr><td class="empty" colspan="10">No hay pagos que coincidan con los filtros.</td></tr>`;
  renderPaymentHistory();
}

function billingReportTitle() {
  return { all: "Resumen completo", cash: "Pagos Cash", insurance: "Pagos de seguros", pending: "Balances pendientes" }[activeBillingTab] || "Resumen completo";
}

function billingReportHtml() {
  const totals = billingTotals(currentBillingRows);
  const totalPending = totals.patientPending + totals.insurancePending;
  const filters = [$("#billingDateFrom").value ? `Desde ${$("#billingDateFrom").value}` : "", $("#billingDateTo").value ? `Hasta ${$("#billingDateTo").value}` : "", $("#billingInsuranceFilter").value, $("#billingSearch").value].filter(Boolean).join(" · ");
  return `<article class="billing-print-sheet"><header><div class="billing-print-brand">${state.settings.clinicLogo ? `<img src="${state.settings.clinicLogo}" alt="Logo de la clínica" />` : ""}<div><h2>${escapeHtml(state.settings.clinicName || "Clinic Control")}</h2><p>${escapeHtml([state.settings.clinicAddress, state.settings.clinicPhone, state.settings.clinicEmail].filter(Boolean).join(" · "))}</p></div></div><div><strong>REPORTE DE PAGOS</strong><span>${new Date().toLocaleDateString("es-US")}</span></div></header><div class="billing-print-context"><strong>${billingReportTitle()}</strong><span>${escapeHtml(filters || "Sin filtros adicionales")}</span></div><div class="billing-print-summary"><div><span>Total facturado</span><strong>${money(totals.billed)}</strong></div><div><span>Facturado Cash</span><strong>${money(totals.cashBilled)}</strong></div><div><span>Cobrado pacientes</span><strong>${money(totals.patientPaid)}</strong></div><div><span>Facturado seguros</span><strong>${money(totals.insuranceBilled)}</strong></div><div><span>Cobrado seguros</span><strong>${money(totals.insurancePaid)}</strong></div><div><span>Balance total</span><strong>${money(totalPending)}</strong><small>Pacientes ${money(totals.patientPending)} · Seguros ${money(totals.insurancePending)}</small></div></div><table><colgroup><col class="print-date" /><col class="print-patient" /><col class="print-type" /><col span="4" class="print-amount" /></colgroup><thead><tr><th>Fecha / Factura</th><th>Paciente / Servicio</th><th>Tipo</th><th>Facturado</th><th>Paciente</th><th>Seguro</th><th>Balance</th></tr></thead><tbody>${currentBillingRows.map((visit) => { const p = patient(visit.patientId); const value = billingVisitAmounts(visit); return `<tr><td>${new Date(visit.date).toLocaleDateString("es-US")}<small>${escapeHtml(invoiceNumber(visit))}</small></td><td><strong>${escapeHtml(p?.name || "Paciente eliminado")}</strong><small>${escapeHtml(visitItems(visit).map((item) => item.description).join(", ") || visit.reason || "Consulta")}</small></td><td>${value.type === "insurance" ? "Seguro" : "Cash"}</td><td>${money(value.total)}</td><td>${money(value.patientPaid)}</td><td>${money(value.insurancePaid)}</td><td>${money(value.patientPending + value.insurancePending)}</td></tr>`; }).join("") || `<tr><td colspan="7">No hay información para los filtros seleccionados.</td></tr>`}</tbody></table><footer>${currentBillingRows.length} registro(s) · Generado el ${new Date().toLocaleString("es-US")}</footer></article>`;
}

function printBillingReport() {
  $("#billingReportPrint").innerHTML = billingReportHtml();
  $("#billingReportDialog").showModal();
  setTimeout(() => window.print(), 100);
}

function addClinicLogoToPdf(pdf, x, y, maxWidth = 52, maxHeight = 36) {
  if (!state.settings.clinicLogo) return 0;
  try {
    const properties = pdf.getImageProperties(state.settings.clinicLogo);
    const ratio = Math.min(maxWidth / properties.width, maxHeight / properties.height);
    const width = properties.width * ratio;
    const height = properties.height * ratio;
    pdf.addImage(state.settings.clinicLogo, properties.fileType || undefined, x, y, width, height, undefined, "FAST");
    return width + 10;
  } catch (error) {
    console.warn("El logo no pudo agregarse al PDF.", error);
    return 0;
  }
}

function downloadBillingPdf() {
  if (!window.jspdf?.jsPDF) { toast("No se pudo cargar el generador de PDF."); return; }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const totals = billingTotals(currentBillingRows);
  const margin = 38;
  const pageWidth = 792;
  const right = pageWidth - margin;
  let y = 38;
  const logoOffset = addClinicLogoToPdf(pdf, margin, 20, 54, 38);
  pdf.setTextColor(15, 118, 110); pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.text(state.settings.clinicName || "Clinic Control", margin + logoOffset, y);
  pdf.setTextColor(23, 32, 51); pdf.setFontSize(15); pdf.text("REPORTE DE PAGOS", right, y, { align: "right" });
  y += 18; pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(80, 95, 115);
  pdf.text(`${billingReportTitle()} - ${new Date().toLocaleDateString("es-US")}`, margin + logoOffset, y);
  pdf.text([state.settings.clinicPhone, state.settings.clinicEmail].filter(Boolean).join(" - "), right, y, { align: "right" });
  y += 20; pdf.setDrawColor(15, 118, 110); pdf.setLineWidth(1.5); pdf.line(margin, y, right, y); y += 13;
  const cards = [
    ["TOTAL FACTURADO", totals.billed, [23, 32, 51]],
    ["CASH FACTURADO", totals.cashBilled, [5, 150, 105]],
    ["CASH COBRADO", totals.patientPaid, [13, 148, 136]],
    ["SEGUROS COBRADOS", totals.insurancePaid, [37, 99, 235]],
    ["BALANCE TOTAL", totals.patientPending + totals.insurancePending, [234, 88, 12]]
  ];
  const cardGap = 8;
  const cardWidth = (right - margin - cardGap * (cards.length - 1)) / cards.length;
  cards.forEach(([label, amount, color], index) => {
    const x = margin + index * (cardWidth + cardGap);
    pdf.setFillColor(248, 250, 252); pdf.setDrawColor(...color); pdf.setLineWidth(1); pdf.roundedRect(x, y, cardWidth, 46, 4, 4, "FD");
    pdf.setTextColor(80, 95, 115); pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.5); pdf.text(label, x + 8, y + 13);
    pdf.setTextColor(...color); pdf.setFontSize(13); pdf.text(money(amount), x + 8, y + 33);
  });
  y += 60;
  pdf.setTextColor(80, 95, 115); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5);
  pdf.text(`Balances separados: pacientes ${money(totals.patientPending)} - seguros ${money(totals.insurancePending)}`, margin, y); y += 16;
  const columns = [
    { label: "FECHA / FACTURA", x: margin, width: 92, align: "left" },
    { label: "PACIENTE / SERVICIO", x: margin + 92, width: 236, align: "left" },
    { label: "TIPO", x: margin + 328, width: 58, align: "left" },
    { label: "FACTURADO", x: margin + 386, width: 82, align: "right" },
    { label: "PACIENTE", x: margin + 468, width: 82, align: "right" },
    { label: "SEGURO", x: margin + 550, width: 82, align: "right" },
    { label: "BALANCE", x: margin + 632, width: 84, align: "right" }
  ];
  const drawHeader = () => {
    pdf.setFillColor(226, 232, 240); pdf.rect(margin, y, right - margin, 24, "F");
    pdf.setTextColor(23, 32, 51); pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.2);
    columns.forEach((column) => pdf.text(column.label, column.align === "right" ? column.x + column.width - 6 : column.x + 6, y + 15, { align: column.align }));
    y += 24;
  };
  drawHeader();
  currentBillingRows.forEach((visit) => {
    const p = patient(visit.patientId); const value = billingVisitAmounts(visit);
    const service = visitItems(visit).map((item) => item.description).join(", ") || visit.reason || "Consulta";
    const patientNameLines = pdf.splitTextToSize(p?.name || "Paciente", columns[1].width - 12);
    const serviceLines = pdf.splitTextToSize(service, columns[1].width - 12);
    const contentLines = patientNameLines.length + serviceLines.length;
    const rowHeight = Math.max(34, contentLines * 8 + 12);
    if (y + rowHeight > 566) { pdf.addPage(); y = 34; pdf.setTextColor(15, 118, 110); pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.text(`${state.settings.clinicName || "Clinic Control"} - Reporte de pagos`, margin, y); y += 14; drawHeader(); }
    const rowTop = y;
    const visitDate = new Date(visit.date).toLocaleDateString("es-US");
    pdf.setTextColor(23, 32, 51); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.4);
    pdf.text(visitDate, columns[0].x + 6, rowTop + 12); pdf.setTextColor(80, 95, 115); pdf.setFontSize(6.7); pdf.text(invoiceNumber(visit), columns[0].x + 6, rowTop + 23);
    pdf.setTextColor(23, 32, 51); pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); pdf.text(patientNameLines, columns[1].x + 6, rowTop + 11);
    const serviceY = rowTop + 11 + patientNameLines.length * 8; pdf.setTextColor(80, 95, 115); pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.8); pdf.text(serviceLines, columns[1].x + 6, serviceY);
    pdf.setTextColor(23, 32, 51); pdf.setFontSize(7.4); pdf.text(value.type === "insurance" ? "Seguro" : "Cash", columns[2].x + 6, rowTop + 15);
    const amountY = rowTop + 15; [value.total, value.patientPaid, value.insurancePaid, value.patientPending + value.insurancePending].forEach((amount, index) => { const column = columns[index + 3]; pdf.text(money(amount), column.x + column.width - 6, amountY, { align: "right" }); });
    y += rowHeight; pdf.setDrawColor(226, 232, 240); pdf.line(margin, y, right, y);
  });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) { pdf.setPage(page); pdf.setTextColor(100, 116, 139); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.text(`Pagina ${page} de ${pages}`, right, 594, { align: "right" }); }
  pdf.save(`reporte-pagos-${activeBillingTab}-${localDateValue()}.pdf`);
}

function renderPaymentHistory() {
  const box = $("#paymentHistory");
  if (!box) return;
  const payments = [...state.payments].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);
  box.innerHTML = payments.length ? payments.map((entry) => {
    const p = patient(entry.patientId);
    const visit = state.visits.find((item) => item.id === entry.visitId);
    const methodLabels = { cash: "Efectivo", card: "Tarjeta", check: "Cheque", transfer: "Transferencia", insurance_eft: "EFT seguro", other: "Otro" };
    return `<div class="payment-history-row"><div class="payment-source-icon ${entry.source}">${entry.source === "insurance" ? "S" : "$"}</div><div><strong>${escapeHtml(p?.name || "Paciente eliminado")}</strong><span>${fmtDate(entry.date)} · ${escapeHtml(methodLabels[entry.method] || entry.method || "Pago")}${entry.reference ? ` · ${escapeHtml(entry.reference)}` : ""}</span><small>${escapeHtml(invoiceNumber(visit || { id: entry.visitId }))}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</small></div><strong>${money(entry.amount)}</strong></div>`;
  }).join("") : `<div class="empty">Todavía no hay movimientos individuales. Los pagos nuevos aparecerán aquí.</div>`;
}

function paymentMethodLabel(method) {
  return { cash: "Efectivo", card: "Tarjeta", check: "Cheque", transfer: "Transferencia", insurance_eft: "EFT de seguro", other: "Otro" }[method] || method || "Pago";
}

function renderVisitPaymentPanel(visit = null) {
  const box = $("#visitPaymentPanel");
  if (!box) return;
  if (!visit?.id) {
    box.innerHTML = `<div class="visit-payment-unsaved"><strong>Guarda primero la consulta</strong><span>Después podrás registrar pagos en cualquier fecha y mantener aquí el historial completo.</span></div>`;
    return;
  }
  const entries = state.payments.filter((entry) => entry.visitId === visit.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const laterPaymentsTotal = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const initialPayment = Math.max(0, totalPaid(visit) - laterPaymentsTotal);
  const currentBalance = balance(visit);
  box.innerHTML = `
    <div class="visit-payment-summary">
      <div><small>Total facturado</small><strong>${money(visit.total)}</strong></div>
      <div><small>Total recibido</small><strong>${money(totalPaid(visit))}</strong></div>
      <div class="${currentBalance > 0 ? "pending" : "paid"}"><small>Balance pendiente</small><strong>${money(currentBalance)}</strong></div>
      <button type="button" class="btn primary" onclick="openPaymentDialog('${visit.id}')" ${currentBalance <= 0 ? "disabled" : ""}>+ Registrar otro pago</button>
    </div>
    <div class="visit-payment-history">
      ${entries.map((entry) => `<div class="visit-payment-entry"><div><strong>${fmtDate(entry.date)}</strong><small>${escapeHtml(paymentMethodLabel(entry.method))}${entry.reference ? ` · ${escapeHtml(entry.reference)}` : ""}</small>${entry.note ? `<span>${escapeHtml(entry.note)}</span>` : ""}</div><span class="badge ${entry.source === "insurance" ? "blue" : "green"}">${entry.source === "insurance" ? "Seguro" : "Paciente"}</span><strong>${money(entry.amount)}</strong></div>`).join("")}
      ${initialPayment > 0 ? `<div class="visit-payment-entry initial-payment"><div><strong>${fmtDate(visit.date)}</strong><small>Pago registrado al crear la consulta</small></div><span class="badge green">Inicial</span><strong>${money(initialPayment)}</strong></div>` : ""}
      ${!entries.length && initialPayment <= 0 ? `<div class="empty document-empty">Todavía no hay pagos registrados para esta consulta.</div>` : ""}
    </div>`;
}

function renderInvoices() {
  const table = $("#invoicesTable");
  if (!table) return;
  const query = ($("#invoiceSearch")?.value || "").toLowerCase().trim();
  const patientId = $("#invoicePatientFilter")?.value || "";
  const rows = [...state.visits]
    .filter((visit) => {
      if (patientId && visit.patientId !== patientId) return false;
      const p = patient(visit.patientId);
      const services = visitItems(visit).map((item) => item.description).join(" ");
      return `${invoiceNumber(visit)} ${p?.name || ""} ${services}`.toLowerCase().includes(query);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  table.innerHTML = rows.length ? rows.map((visit) => {
    const p = patient(visit.patientId);
    const items = visitItems(visit);
    const due = balance(visit);
    return `
      <tr>
        <td><strong>${escapeHtml(invoiceNumber(visit))}</strong></td>
        <td>${fmtDate(visit.date)}</td>
        <td><strong>${escapeHtml(p?.name || "Paciente eliminado")}</strong></td>
        <td>${items.length} concepto(s)<br><small>${escapeHtml(items.map((item) => item.description).join(", ") || "Sin detalle")}</small></td>
        <td>${money(visit.total)}</td>
        <td>${money(totalPaid(visit))}</td>
        <td><span class="badge ${due > 0 ? "red" : "green"}">${money(due)}</span></td>
        <td><button class="btn light invoice-view" onclick="openInvoice('${visit.id}')">Ver factura</button></td>
      </tr>
    `;
  }).join("") : `<tr><td class="empty" colspan="8">No hay facturas registradas.</td></tr>`;
}

function renderInvoicePatientOptions() {
  const select = $("#invoicePatientFilter");
  if (!select) return;
  const selected = select.value;
  const patientIdsWithVisits = new Set(state.visits.map((visit) => visit.patientId));
  const options = state.patients
    .filter((item) => patientIdsWithVisits.has(item.id))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  select.innerHTML = `<option value="">Todos los clientes</option>${options.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  if (options.some((item) => item.id === selected)) select.value = selected;
}

function openInvoice(id) {
  const visit = state.visits.find((item) => item.id === id);
  if (!visit) return;
  const p = patient(visit.patientId);
  const items = visitItems(visit);
  const due = balance(visit);
  const design = invoiceSettings();
  const clinicContacts = [
    design.showAddress ? state.settings.clinicAddress : "",
    design.showPhone ? state.settings.clinicPhone : "",
    design.showEmail ? state.settings.clinicEmail : ""
  ].filter(Boolean).join(" · ");
  activeInvoiceId = id;
  $("#invoiceDialogTitle").textContent = invoiceNumber(visit);
  $("#invoiceDetail").innerHTML = `
    <article class="invoice-sheet logo-${design.logoPosition}" style="--invoice-accent:${escapeHtml(design.accent)}">
      <header>
        <div class="invoice-clinic-brand">${state.settings.clinicLogo ? `<img src="${state.settings.clinicLogo}" alt="Logo" />` : ""}<div><h2>${escapeHtml(state.settings.clinicName || "Clinic Control")}</h2><p>${escapeHtml(clinicContacts)}</p></div></div>
        <div class="invoice-heading"><strong>FACTURA</strong><span>${escapeHtml(invoiceNumber(visit))}</span></div>
      </header>
      <div class="invoice-meta">
        <div><small>Paciente</small><strong>${escapeHtml(p?.name || "Paciente eliminado")}</strong><span>${escapeHtml(p?.phone || "")}</span><span>${escapeHtml(payerLabel(p))}</span></div>
        <div><small>Fecha</small><strong>${fmtDate(visit.date)}</strong>${design.showDoctor ? `<span>${escapeHtml(visit.doctor || "Sin doctor asignado")}</span>` : ""}${design.showInsurance ? `<span>${escapeHtml(payerLabel(p))}</span>` : ""}</div>
      </div>
      <table class="invoice-items">
        <thead><tr><th>Descripción del servicio</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr></thead>
        <tbody>${items.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${money(item.unitPrice)}</td><td>${money(item.price)}</td></tr>`).join("")}</tbody>
      </table>
      <div class="invoice-summary">
        <div><span>Total</span><strong>${money(visit.total)}</strong></div>
        <div><span>Pagado por paciente</span><strong>${money(visit.patientPaid ?? (paymentType(visit) === "cash" ? visit.paid : 0))}</strong></div>
        ${paymentType(visit) === "insurance" ? `<div><span>Pagado por seguro</span><strong>${money(visit.insurancePaid ?? visit.paid)}</strong></div><div><span>Copago esperado</span><strong>${money(visit.copay)}</strong></div>` : ""}
        <div class="invoice-balance"><span>Balance</span><strong>${money(due)}</strong></div>
      </div>
      ${paymentType(visit) === "insurance" ? `<div class="invoice-claim"><div><small>Reclamación</small><strong>${escapeHtml(visit.claimNumber || "Sin número")}</strong></div><div><small>Estado</small><strong>${escapeHtml({draft:"Preparada",submitted:"Enviada",processing:"En proceso",paid:"Pagada",partial:"Pago parcial",rejected:"Rechazada"}[visit.claimStatus] || "No indicado")}</strong></div></div>` : ""}
      ${visit.notes ? `<div class="invoice-notes"><strong>Notas</strong><p>${escapeHtml(visit.notes)}</p></div>` : ""}
      ${design.footer ? `<footer class="invoice-footer">${escapeHtml(design.footer)}</footer>` : ""}
    </article>`;
  $("#invoiceDialog").showModal();
}

function downloadInvoicePdf(id = activeInvoiceId) {
  const visit = state.visits.find((item) => item.id === id);
  if (!visit) return;
  if (!window.jspdf?.jsPDF) {
    toast("No se pudo cargar el generador de PDF.");
    return;
  }

  const p = patient(visit.patientId);
  const items = visitItems(visit);
  const design = invoiceSettings();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const left = 48;
  const right = 564;
  let y = 52;

  const accentRgb = design.accent.match(/[a-f\d]{2}/gi)?.map((part) => parseInt(part, 16)) || [15, 118, 110];
  pdf.setTextColor(...accentRgb);
  pdf.setFontSize(20);
  pdf.setFont("helvetica", "bold");
  let clinicNameX = left;
  if (design.logoPosition === "left") clinicNameX += addClinicLogoToPdf(pdf, left, 20, 46, 32);
  else if (design.logoPosition === "center") addClinicLogoToPdf(pdf, 278, 18, 46, 32);
  else addClinicLogoToPdf(pdf, 466, 18, 46, 32);
  pdf.text(state.settings.clinicName || "Clinic Control", clinicNameX, y);
  pdf.setFontSize(17);
  pdf.text("FACTURA", right, y, { align: "right" });
  y += 22;
  pdf.setTextColor(80, 95, 115);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  const pdfContacts = [design.showAddress ? state.settings.clinicAddress : "", design.showPhone ? state.settings.clinicPhone : "", design.showEmail ? state.settings.clinicEmail : ""].filter(Boolean).join(" · ");
  pdf.text(pdfContacts, left, y);
  pdf.text(invoiceNumber(visit), right, y, { align: "right" });
  y += 24;
  pdf.setDrawColor(...accentRgb);
  pdf.line(left, y, right, y);
  y += 28;

  pdf.setTextColor(23, 32, 51);
  pdf.setFont("helvetica", "bold");
  pdf.text(`Cliente: ${p?.name || "Paciente eliminado"}`, left, y);
  pdf.text(`Fecha: ${fmtDate(visit.date)}`, 320, y);
  y += 17;
  pdf.setFont("helvetica", "normal");
  pdf.text(`Teléfono: ${p?.phone || "No indicado"}`, left, y);
  if (design.showDoctor) pdf.text(`Doctor: ${visit.doctor || "No indicado"}`, 320, y);
  y += 17;
  if (design.showInsurance) pdf.text(`Responsable de pago: ${payerLabel(p)}`, left, y);
  if (design.showInsurance && p?.payerType === "insurance" && p.insuranceMemberId) pdf.text(`ID de miembro: ${p.insuranceMemberId}`, 320, y);
  y += 32;

  pdf.setFillColor(241, 245, 249);
  pdf.rect(left, y - 14, right - left, 24, "F");
  pdf.setFont("helvetica", "bold");
  pdf.text("Descripción del servicio", left + 8, y);
  pdf.text("Cant.", 390, y, { align: "right" });
  pdf.text("Precio", 470, y, { align: "right" });
  pdf.text("Total", right - 8, y, { align: "right" });
  y += 26;

  pdf.setFont("helvetica", "normal");
  items.forEach((item) => {
    const lines = pdf.splitTextToSize(item.description || "Servicio", 280);
    const rowHeight = Math.max(22, lines.length * 13 + 8);
    if (y + rowHeight > 700) {
      pdf.addPage();
      y = 52;
    }
    pdf.text(lines, left + 8, y);
    pdf.text(String(item.quantity || 1), 390, y, { align: "right" });
    pdf.text(money(item.unitPrice), 470, y, { align: "right" });
    pdf.text(money(item.price), right - 8, y, { align: "right" });
    y += rowHeight;
    pdf.setDrawColor(226, 232, 240);
    pdf.line(left, y - 8, right, y - 8);
  });

  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.text(`Total: ${money(visit.total)}`, right, y, { align: "right" });
  y += 18;
  pdf.text(`Pagado: ${money(totalPaid(visit))}`, right, y, { align: "right" });
  y += 18;
  pdf.setTextColor(balance(visit) > 0 ? 185 : 4, balance(visit) > 0 ? 28 : 120, balance(visit) > 0 ? 28 : 87);
  pdf.text(`Balance: ${money(balance(visit))}`, right, y, { align: "right" });
  if (design.footer) {
    pdf.setTextColor(80, 95, 115);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(design.footer, 306, 750, { align: "center", maxWidth: 500 });
  }

  pdf.save(`${invoiceNumber(visit)}-${(p?.name || "cliente").replace(/[^a-z0-9áéíóúñ]+/gi, "-")}.pdf`);
}

function renderReports() {
  const dayVisits = state.visits.filter((visit) => onlyDate(visit.date) === today());
  const dayTotals = totals(dayVisits);
  const all = totals();

  $("#reportCard").innerHTML = `
    <h2>${state.settings.clinicName || "Clinic Control"}</h2>
    <p>${state.settings.clinicAddress || ""} · ${state.settings.clinicPhone || ""} · ${state.settings.clinicEmail || ""}</p>
    <p><strong>Fecha:</strong> ${new Date().toLocaleDateString("es-US")}</p>

    <div class="report-metrics">
      <div class="report-metric">
        <span>Consultas hoy</span>
        <strong>${dayVisits.length}</strong>
      </div>
      <div class="report-metric">
        <span>Facturado hoy</span>
        <strong>${money(dayTotals.billed)}</strong>
      </div>
      <div class="report-metric">
        <span>Cobrado hoy</span>
        <strong>${money(dayTotals.paid)}</strong>
      </div>
      <div class="report-metric">
        <span>Total pendiente</span>
        <strong>${money(all.debt)}</strong>
      </div>
    </div>

    <div class="data-card">
      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Paciente</th>
            <th>Tipo</th>
            <th>Motivo</th>
            <th>Total</th>
            <th>Pagado</th>
          </tr>
        </thead>
        <tbody>
          ${dayVisits.length ? dayVisits.map((visit) => `
            <tr>
              <td>${fmtDate(visit.date)}</td>
              <td>${patient(visit.patientId)?.name || "Paciente eliminado"}</td>
              <td>${visit.type}</td>
              <td>${visit.reason}</td>
              <td>${money(visit.total)}</td>
              <td>${money(totalPaid(visit))}</td>
            </tr>
          `).join("") : `<tr><td class="empty" colspan="6">No hay consultas registradas hoy.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderSettings() {
  const clinicName = state.settings.clinicName || "Clinic Control";
  $("#clinicBrandName").textContent = clinicName;
  $("#clinicBrandLogo").classList.toggle("has-clinic-logo", Boolean(state.settings.clinicLogo));
  $("#clinicBrandLogo").innerHTML = state.settings.clinicLogo ? `<img src="${state.settings.clinicLogo}" alt="" />` : `<span></span>`;
  $("#heroClinicTitle").textContent = state.settings.clinicName
    ? `Control diario de ${state.settings.clinicName}`
    : "Control diario de la clínica";
  document.title = `${clinicName} · Clinic Control`;
  $("#clinicName").value = state.settings.clinicName || "";
  $("#clinicAddress").value = state.settings.clinicAddress || "";
  $("#clinicPhone").value = state.settings.clinicPhone || "";
  $("#clinicEmail").value = state.settings.clinicEmail || "";
  $("#invoicePrefix").value = state.settings.invoicePrefix || "FAC";
  $("#invoiceAccentColor").value = state.settings.invoiceAccentColor || "#0f766e";
  $("#invoiceLogoPosition").value = state.settings.invoiceLogoPosition || "left";
  $("#invoiceFooter").value = state.settings.invoiceFooter ?? "Gracias por confiar en nuestra clínica.";
  $("#invoiceShowAddress").checked = state.settings.invoiceShowAddress !== false;
  $("#invoiceShowPhone").checked = state.settings.invoiceShowPhone !== false;
  $("#invoiceShowEmail").checked = state.settings.invoiceShowEmail !== false;
  $("#invoiceShowDoctor").checked = state.settings.invoiceShowDoctor !== false;
  $("#invoiceShowInsurance").checked = state.settings.invoiceShowInsurance !== false;
  $("#clinicLogoPreview").innerHTML = state.settings.clinicLogo
    ? `<img src="${state.settings.clinicLogo}" alt="Logo de la clínica" />`
    : `<span>Sin logo</span>`;
  renderInvoiceStylePreview();
  renderClinicDocuments();
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderClinicDocuments() {
  const box = $("#clinicDocumentsList");
  if (!box) return;
  box.innerHTML = state.documents.length ? state.documents.map((item) => `
    <div class="document-row">
      <span class="document-icon">${item.type === "application/pdf" ? "PDF" : "DOC"}</span>
      <div><strong>${escapeHtml(item.name)}</strong><small>${formatFileSize(item.size)} · Disponible en consultas</small></div>
      <a class="btn light" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Abrir</a>
      <button class="btn light document-delete" type="button" onclick="deleteClinicDocument('${item.id}')">Eliminar</button>
    </div>`).join("") : `<div class="empty document-empty">Todavía no hay documentos cargados.</div>`;
}

function renderVisitDocuments(selectedDocuments = []) {
  const box = $("#visitDocuments");
  const prior = new Map((selectedDocuments || []).map((item) => [item.documentId, item]));
  const available = state.documents.map((item) => ({ ...item, ...(prior.get(item.id) || {}) }));
  const archivedSigned = (selectedDocuments || []).filter((item) => item.status === "signed" && !state.documents.some((documentItem) => documentItem.id === item.documentId));
  const choices = [...available, ...archivedSigned.map((item) => ({ id: item.documentId, ...item, archived: true }))];
  box.innerHTML = choices.length ? choices.map((item) => `
    <label class="document-choice">
      <input type="checkbox" value="${item.id}" ${prior.has(item.id) || item.status === "signed" ? "checked" : ""} ${item.status === "signed" ? "disabled" : ""} />
      <span><strong>${escapeHtml(item.name)}</strong><small>${item.status === "signed" ? `Firmado por ${escapeHtml(item.signedBy)}` : "Quedará pendiente de firma"}${item.archived ? " · Archivado" : ""}</small></span>
      ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Ver</a>` : ""}
    </label>`).join("") : `<div class="empty document-empty">No hay documentos disponibles. Súbelos primero desde Ajustes.</div>`;
}

function collectVisitDocuments(existing = []) {
  const prior = new Map((existing || []).map((item) => [item.documentId, item]));
  return [...$("#visitDocuments").querySelectorAll('input[type="checkbox"]:checked')].map((input) => {
    const item = state.documents.find((documentItem) => documentItem.id === input.value);
    const previous = prior.get(input.value) || {};
    return { ...previous, documentId: input.value, name: item?.name || previous.name || "Documento", url: item?.url || previous.url || "", status: previous.status || "pending" };
  });
}

function currentSignatureVisit() {
  return state.visits.find((visit) => visit.id === activeSignatureVisitId);
}

function currentSignatureDocument() {
  return currentSignatureVisit()?.documents?.find((item) => item.documentId === activeSignatureDocumentId);
}

function openSignatureDialog(visitId) {
  const visit = state.visits.find((item) => item.id === visitId);
  if (!visit?.documents?.length) return toast("Esta consulta no tiene documentos asignados.");
  activeSignatureVisitId = visitId;
  activeSignatureDocumentId = visit.documents.find((item) => item.status !== "signed")?.documentId || visit.documents[0].documentId;
  const p = patient(visit.patientId);
  $("#signatureDialogTitle").textContent = p?.name || "Firma del paciente";
  $("#signatureSignerName").value = p?.name || "";
  $("#signatureConsent").checked = false;
  $("#signatureDialog").showModal();
  renderSignatureDialog();
}

function selectSignatureDocument(documentId) {
  activeSignatureDocumentId = documentId;
  $("#signatureConsent").checked = false;
  renderSignatureDialog();
}

function renderSignatureDialog() {
  const visit = currentSignatureVisit();
  const documentItem = currentSignatureDocument();
  if (!visit || !documentItem) return;
  $("#signatureDocumentList").innerHTML = visit.documents.map((item) => `
    <button type="button" class="signature-document-item ${item.documentId === activeSignatureDocumentId ? "active" : ""}" onclick="selectSignatureDocument('${item.documentId}')">
      <span>${item.status === "signed" ? "✓" : "○"}</span><div><strong>${escapeHtml(item.name)}</strong><small>${item.status === "signed" ? `Firmado ${fmtDate(item.signedAt)}` : "Pendiente de firma"}</small></div>
    </button>`).join("");
  $("#signatureDocumentContext").innerHTML = `<div><small>Documento seleccionado</small><strong>${escapeHtml(documentItem.name)}</strong></div>${documentItem.url ? `<a class="btn light" href="${escapeHtml(documentItem.url)}" target="_blank" rel="noopener">Abrir documento</a>` : ""}`;
  const preview = $("#savedSignaturePreview");
  preview.classList.toggle("hidden", documentItem.status !== "signed");
  preview.innerHTML = documentItem.status === "signed" ? `<small>Firma guardada</small><img src="${escapeHtml(documentItem.signatureUrl)}" alt="Firma de ${escapeHtml(documentItem.signedBy)}" /><strong>${escapeHtml(documentItem.signedBy)}</strong><span>${new Date(documentItem.signedAt).toLocaleString("es-US")}</span>` : "";
  $("#saveSignatureBtn").textContent = documentItem.status === "signed" ? "Reemplazar firma" : "Guardar firma";
  requestAnimationFrame(setupSignatureCanvas);
}

function setupSignatureCanvas() {
  const canvas = $("#signatureCanvas");
  const width = Math.max(280, canvas.parentElement.clientWidth - 2);
  const height = 210;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2.4;
  context.strokeStyle = "#172033";
  signatureHasInk = false;
}

function clearSignatureCanvas() {
  setupSignatureCanvas();
}

async function saveCurrentSignature() {
  const visit = currentSignatureVisit();
  const documentItem = currentSignatureDocument();
  const signedBy = $("#signatureSignerName").value.trim();
  if (!signedBy) return toast("Escribe el nombre de quien firma.");
  if (!signatureHasInk) return toast("Dibuja la firma antes de guardarla.");
  if (!$("#signatureConsent").checked) return toast("Confirma la aceptación de la firma electrónica.");
  const button = $("#saveSignatureBtn");
  try {
    button.disabled = true;
    const canvas = $("#signatureCanvas");
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const signatureId = uid();
    const path = `clinics/${auth.currentUser.uid}/signatures/${visit.id}/${documentItem.documentId}/${signatureId}.png`;
    const ref = storage.ref(path);
    await ref.put(blob, { contentType: "image/png" });
    const signatureUrl = await ref.getDownloadURL();
    const signedAt = new Date().toISOString();
    const documents = visit.documents.map((item) => item.documentId === documentItem.documentId ? { ...item, status: "signed", signedBy, signedAt, signatureUrl, signaturePath: path, consentAccepted: true, signedByUserId: auth.currentUser.uid } : item);
    await saveVisit({ id: visit.id, documents });
    if (documentItem.signaturePath && documentItem.signaturePath !== path) storage.ref(documentItem.signaturePath).delete().catch(() => {});
    visit.documents = documents;
    renderSignatureDialog();
    renderVisits();
    toast("Firma guardada correctamente");
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar la firma");
  } finally {
    button.disabled = false;
  }
}

function renderInvoiceStylePreview() {
  const preview = $("#invoiceStylePreview");
  if (!preview) return;
  const color = $("#invoiceAccentColor")?.value || "#0f766e";
  const position = $("#invoiceLogoPosition")?.value || "left";
  preview.style.setProperty("--preview-accent", color);
  preview.className = `invoice-preview full logo-${position}`;
  preview.innerHTML = `
    <div class="preview-brand">${state.settings.clinicLogo ? `<img src="${state.settings.clinicLogo}" alt="" />` : `<span class="preview-logo-placeholder">LOGO</span>`}<strong>${escapeHtml($("#clinicName")?.value || "Nombre de la clínica")}</strong></div>
    <div><b>FACTURA</b><small>${escapeHtml($("#invoicePrefix")?.value || "FAC")}-000001</small></div>
    <p>${escapeHtml($("#invoiceFooter")?.value || "")}</p>`;
}

function openAppointmentDialog(item = null) {
  if (!state.patients.length) { toast("Primero registra un paciente."); openPatientDialog(); return; }
  renderVisitOptions();
  $("#appointmentDialogTitle").textContent = item ? "Editar cita" : "Nueva cita";
  $("#appointmentId").value = item?.id || "";
  $("#appointmentPatient").value = item?.patientId || state.patients[0].id;
  const defaultDate = `${$("#appointmentDateFilter")?.value || localDateValue()}T09:00`;
  $("#appointmentDate").value = item?.date || defaultDate;
  $("#appointmentDuration").value = String(item?.duration || 30);
  $("#appointmentType").value = item?.type || "Presencial";
  $("#appointmentDoctor").value = item?.doctor || "";
  $("#appointmentStatus").value = item?.status || "scheduled";
  $("#appointmentReason").value = item?.reason || "";
  $("#appointmentReminder").checked = item ? Boolean(item.reminderEnabled) : true;
  $("#appointmentNotes").value = item?.notes || "";
  $("#appointmentDialog").showModal();
  requestAnimationFrame(() => $("#appointmentPatient").focus());
}

function openAppointmentAt(date) {
  openAppointmentDialog();
  $("#appointmentDate").value = date;
  const selectedDoctor = $("#appointmentDoctorFilter")?.value;
  if (selectedDoctor) $("#appointmentDoctor").value = selectedDoctor;
}

function showAppointmentDay(date) {
  appointmentView = "day";
  localStorage.setItem("clinicAppointmentView", appointmentView);
  $("#appointmentDateFilter").value = date;
  renderAppointments();
}

function editAppointment(id) {
  const item = state.appointments.find((appointment) => appointment.id === id);
  if (item) openAppointmentDialog(item);
}

async function deleteAppointment(id) {
  if (!confirm("¿Eliminar esta cita?")) return;
  try { await deleteAppointmentEntry(id); toast("Cita eliminada"); } catch (error) { console.error(error); toast("No se pudo eliminar la cita"); }
}

async function cancelAppointment(id) {
  const item = state.appointments.find((appointment) => appointment.id === id);
  if (!item) return;
  const reason = prompt("Motivo de cancelación (opcional):", item.cancellationReason || "");
  if (reason === null) return;
  try {
    await saveAppointment({ ...item, status: "cancelled", cancellationReason: reason.trim(), cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    toast("Cita cancelada y conservada en el historial");
  } catch (error) { console.error(error); toast("No se pudo cancelar la cita"); }
}

function findAppointmentConflict(candidate) {
  const candidateStart = new Date(candidate.date).getTime();
  const candidateEnd = candidateStart + candidate.duration * 60000;
  return state.appointments.find((item) => {
    if (item.id === candidate.id || ["cancelled", "no_show"].includes(item.status)) return false;
    const itemStart = new Date(item.date).getTime();
    const itemEnd = itemStart + Number(item.duration || 30) * 60000;
    const overlaps = candidateStart < itemEnd && candidateEnd > itemStart;
    if (!overlaps) return false;
    const samePatient = item.patientId === candidate.patientId;
    const sameDoctor = candidate.doctor && item.doctor && candidate.doctor.toLowerCase() === item.doctor.toLowerCase();
    return samePatient || sameDoctor;
  });
}

async function setAppointmentStatus(id, status) {
  const item = state.appointments.find((appointment) => appointment.id === id);
  if (!item) return;
  try { await saveAppointment({ ...item, status, updatedAt: new Date().toISOString() }); toast(`Cita ${appointmentStatus(status).label.toLowerCase()}`); } catch (error) { console.error(error); toast("No se pudo actualizar la cita"); }
}

async function startAppointmentVisit(id) {
  const item = state.appointments.find((appointment) => appointment.id === id);
  if (!item) return;
  await setAppointmentStatus(id, "arrived");
  showPage("visits");
  openVisitDialog({ patientId: item.patientId, date: item.date, type: item.type, doctor: item.doctor, reason: item.reason, notes: item.notes, status: "Completada", appointmentId: item.id });
}

function openPaymentDialog(visitId = "", patientId = "") {
  const eligible = state.visits.filter((visit) => balance(visit) > 0 && (!patientId || visit.patientId === patientId));
  if (!eligible.length) { toast("No hay facturas con balance pendiente."); return; }
  $("#paymentVisit").innerHTML = eligible.map((visit) => `<option value="${visit.id}">${escapeHtml(patient(visit.patientId)?.name || "Paciente")} · ${escapeHtml(invoiceNumber(visit))} · ${money(balance(visit))}</option>`).join("");
  $("#paymentVisit").value = eligible.some((visit) => visit.id === visitId) ? visitId : eligible[0].id;
  $("#paymentDate").value = new Date().toISOString().slice(0, 16);
  $("#paymentAmount").value = "";
  $("#paymentReference").value = "";
  $("#paymentNote").value = "";
  updatePaymentContext();
  $("#paymentDialog").showModal();
  requestAnimationFrame(() => $("#paymentAmount").focus());
}

function updatePaymentContext() {
  const visit = state.visits.find((item) => item.id === $("#paymentVisit").value);
  if (!visit) return;
  const p = patient(visit.patientId);
  const insured = paymentType(visit) === "insurance";
  $("#paymentSource").value = insured ? "insurance" : "patient";
  $("#paymentMethod").value = insured ? "insurance_eft" : "cash";
  $("#paymentAmount").max = balance(visit).toFixed(2);
  $("#paymentContext").innerHTML = `<div><small>Paciente</small><strong>${escapeHtml(p?.name || "Paciente")}</strong></div><div><small>Factura</small><strong>${escapeHtml(invoiceNumber(visit))}</strong></div><div><small>Balance actual</small><strong>${money(balance(visit))}</strong></div>`;
}

function openPatientFinance(id) {
  const p = patient(id);
  if (!p) return;
  activeFinancePatientId = id;
  const visits = state.visits.filter((visit) => visit.patientId === id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const entries = state.payments.filter((entry) => entry.patientId === id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const data = totals(visits);
  $("#patientFinanceTitle").textContent = p.name;
  $("#patientFinanceDetail").innerHTML = `<div class="finance-profile-summary"><div><small>Facturado</small><strong>${money(data.billed)}</strong></div><div><small>Pagado</small><strong>${money(data.paid)}</strong></div><div><small>Balance</small><strong>${money(data.debt)}</strong></div></div>
    <div class="finance-profile-info"><span>${escapeHtml(p.phone || "Sin teléfono")}</span><span>${escapeHtml(payerLabel(p))}</span>${p.insuranceMemberId ? `<span>Póliza: ${escapeHtml(p.insuranceMemberId)}</span>` : ""}</div>
    <h4>Facturas y consultas</h4><div class="finance-profile-list">${visits.length ? visits.map((visit) => `<div><span>${fmtDate(visit.date)}<small>${escapeHtml(invoiceNumber(visit))} · ${escapeHtml(visit.reason || "Consulta")}</small></span><strong>${money(balance(visit))}<small>balance</small></strong><button class="btn light" onclick="openInvoice('${visit.id}')">Factura</button></div>`).join("") : `<div class="empty">Sin facturas.</div>`}</div>
    <h4>Movimientos</h4><div class="finance-profile-list">${entries.length ? entries.map((entry) => `<div><span>${fmtDate(entry.date)}<small>${entry.source === "insurance" ? "Seguro" : "Paciente"} · ${escapeHtml(entry.reference || entry.method || "Pago")}</small></span><strong>${money(entry.amount)}</strong></div>`).join("") : `<div class="empty">Sin movimientos individuales.</div>`}</div>`;
  $("#patientFinancePaymentBtn").disabled = data.debt <= 0;
  $("#patientFinanceDialog").showModal();
}

function openPatientDialog(p = null) {
  $("#patientDialogTitle").textContent = p ? "Editar paciente" : "Nuevo paciente";
  $("#patientSubmitBtn").textContent = p ? "Guardar cambios" : "Guardar paciente";
  $("#patientId").value = p?.id || "";
  $("#patientName").value = p?.name || "";
  $("#patientPhone").value = p?.phone || "";
  $("#patientEmail").value = p?.email || "";
  $("#patientAge").value = p?.age ?? "";
  $("#patientBirthDate").value = p?.birthDate || "";
  $("#patientBirthDate").max = today();
  $("#patientLanguage").value = p?.language || "Español";
  $("#patientPayerType").value = p?.payerType || "self_pay";
  $("#patientInsuranceCompany").value = p?.insuranceCompany || "";
  $("#patientInsuranceMemberId").value = p?.insuranceMemberId || "";
  $("#patientInsuranceGroup").value = p?.insuranceGroup || "";
  togglePatientInsuranceFields();
  $("#patientEmailNotifications").checked = Boolean(p?.emailNotificationsEnabled);
  $("#patientSmsNotifications").checked = Boolean(p?.smsNotificationsEnabled);
  $("#patientBirthdayEmail").checked = Boolean(p?.birthdayEmailEnabled);
  $("#patientDocument").value = p?.document || "";
  $("#patientNotes").value = p?.notes || "";
  clearFormErrors($("#patientForm"));
  $("#patientDialog").showModal();
  requestAnimationFrame(() => $("#patientName").focus());
}

function openVisitDialog(visit = null) {
  if (!state.patients.length) {
    toast("Primero registra un paciente.");
    openPatientDialog();
    return;
  }

  renderVisitOptions();
  pendingAppointmentId = visit?.appointmentId || null;

  $("#visitDialogTitle").textContent = visit?.id ? "Editar consulta" : "Nueva consulta";
  $("#visitId").value = visit?.id || "";
  $("#visitPatient").value = visit?.patientId || state.patients[0].id;
  $("#visitType").value = visit?.type || "Presencial";
  $("#visitDate").value = visit?.date || new Date().toISOString().slice(0, 16);
  $("#visitDoctor").value = visit?.doctor || "";
  $("#visitStatus").value = visit?.status || (visit?.id ? "Completada" : "Programada");
  $("#visitReminderEnabled").checked = visit?.id ? Boolean(visit.reminderEnabled) : false;
  renderVisitLineItems(visitItems(visit));
  const inferredType = visit ? paymentType(visit) : (patient($("#visitPatient").value)?.payerType === "insurance" ? "insurance" : "cash");
  $("#visitPaymentType").value = inferredType;
  $("#visitPaid").value = visit?.patientPaid ?? (inferredType === "cash" ? (visit?.paid ?? 0) : 0);
  $("#visitInsurancePaid").value = visit?.insurancePaid ?? (inferredType === "insurance" ? (visit?.paid ?? 0) : 0);
  $("#visitClaimStatus").value = visit?.claimStatus || "draft";
  $("#visitClaimNumber").value = visit?.claimNumber || "";
  $("#visitCopay").value = visit?.copay ?? 0;
  toggleVisitInsuranceFields();
  $("#visitReason").value = visit?.reason || "";
  $("#visitNotes").value = visit?.notes || "";
  renderVisitPaymentPanel(visit);
  renderVisitDocuments(visit?.documents || []);
  renderVisitPatientBanner();
  clearFormErrors($("#visitForm"));
  showPage("visitDialog");
  window.scrollTo({ top: 0, behavior: "smooth" });
  requestAnimationFrame(() => $("#visitPatient").focus());
}

function renderVisitPatientBanner() {
  const p = patient($("#visitPatient").value);
  const banner = $("#visitPatientBanner");
  if (!p) {
    banner.innerHTML = `<div class="patient-avatar">?</div><div><small>Paciente</small><strong>Selecciona un paciente</strong></div>`;
    return;
  }
  const initials = p.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  banner.innerHTML = `
    <div class="patient-avatar">${escapeHtml(initials)}</div>
    <div class="patient-banner-name"><small>Expediente del paciente</small><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.document || "Sin documento")}</span></div>
    <div><small>Edad</small><strong>${escapeHtml(p.age || "—")}</strong></div>
    <div><small>Teléfono</small><strong>${escapeHtml(p.phone || "—")}</strong></div>
    <div><small>Seguro</small><strong>${escapeHtml(p.insuranceCompany || (p.payerType === "insurance" ? "Registrado" : "Pago propio"))}</strong></div>`;
}

function closeVisitWorkspace() {
  pendingAppointmentId = null;
  showPage("visits");
}

function renderVisitLineItems(items = []) {
  const box = $("#visitLineItems");
  const rows = items.length ? items : [{ id: uid(), description: "", price: "" }];
  box.innerHTML = rows.map((item) => `
    <div class="service-line" data-line-id="${escapeHtml(item.id || uid())}">
      <label class="field-group"><span class="field-label">Servicio o procedimiento</span>
        <input class="service-description" type="text" value="${escapeHtml(item.description)}" placeholder="Ej. Consulta, tratamiento o producto" />
      </label>
      <label class="field-group service-quantity-field"><span class="field-label">Cantidad</span><input class="service-quantity" type="number" step="1" min="1" value="${item.quantity || 1}" /></label>
      <label class="field-group"><span class="field-label">Precio unitario</span>
        <div class="input-prefix"><span>$</span><input class="service-price" type="number" step="0.01" min="0" value="${item.unitPrice ?? item.price ?? ""}" placeholder="0.00" /></div>
      </label>
      <div class="service-line-total"><small>Total</small><strong>${money(item.price)}</strong></div>
      <button type="button" class="icon-btn service-remove" title="Eliminar servicio">×</button>
    </div>`).join("");

  box.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
    updateVisitTotal();
    validateVisitForm();
  }));
  box.querySelectorAll(".service-remove").forEach((button) => button.addEventListener("click", () => {
    if (box.children.length === 1) {
      box.querySelector(".service-description").value = "";
      box.querySelector(".service-price").value = "";
      box.querySelector(".service-quantity").value = "1";
    } else {
      button.closest(".service-line").remove();
    }
    updateVisitTotal();
    validateVisitForm();
  }));
  updateVisitTotal();
}

function collectVisitLineItems() {
  return [...$("#visitLineItems").querySelectorAll(".service-line")].map((row) => ({
    id: row.dataset.lineId || uid(),
    description: row.querySelector(".service-description").value.trim(),
    quantity: Math.max(1, Number(row.querySelector(".service-quantity").value || 1)),
    unitPrice: Number(row.querySelector(".service-price").value || 0),
    price: Math.max(1, Number(row.querySelector(".service-quantity").value || 1)) * Number(row.querySelector(".service-price").value || 0)
  }));
}

function updateVisitTotal() {
  const total = collectVisitLineItems().reduce((sum, item) => sum + item.price, 0);
  $("#visitTotal").value = total.toFixed(2);
  [...$("#visitLineItems").querySelectorAll(".service-line")].forEach((row) => {
    const quantity = Math.max(1, Number(row.querySelector(".service-quantity").value || 1));
    const price = Number(row.querySelector(".service-price").value || 0);
    row.querySelector(".service-line-total strong").textContent = money(quantity * price);
  });
}

function toggleVisitInsuranceFields() {
  $("#visitInsuranceBilling").classList.toggle("hidden", $("#visitPaymentType").value !== "insurance");
}

function setFieldError(input, errorElement, message = "") {
  const field = input.closest(".field-group");
  field?.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", message ? "true" : "false");
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.classList.toggle("visible", Boolean(message));
  }
}

function clearFormErrors(form) {
  form.querySelectorAll(".field-group").forEach((field) => field.classList.remove("has-error"));
  form.querySelectorAll(".field-error").forEach((error) => {
    error.textContent = "";
    error.classList.remove("visible");
  });
  form.querySelectorAll("[aria-invalid]").forEach((input) => input.setAttribute("aria-invalid", "false"));
}

function togglePatientInsuranceFields() {
  const insured = $("#patientPayerType").value === "insurance";
  $("#patientInsuranceFields").classList.toggle("hidden", !insured);
}

function validatePatientForm() {
  const name = $("#patientName");
  const age = $("#patientAge");
  const birthDate = $("#patientBirthDate");
  const phone = $("#patientPhone");
  const email = $("#patientEmail");
  const emailNotificationsEnabled = $("#patientEmailNotifications").checked;
  const smsNotificationsEnabled = $("#patientSmsNotifications").checked;
  const birthdayEmailEnabled = $("#patientBirthdayEmail").checked;
  const insured = $("#patientPayerType").value === "insurance";
  const insuranceCompany = $("#patientInsuranceCompany");
  const insuranceMemberId = $("#patientInsuranceMemberId");
  const trimmedName = name.value.trim();
  const ageNumber = age.value === "" ? null : Number(age.value);
  const birthDateMessage = birthDate.value && birthDate.value > today() ? "La fecha de nacimiento no puede ser futura." : "";
  const emailMessage = (emailNotificationsEnabled || birthdayEmailEnabled) && !email.value.trim()
    ? "Agrega un correo para autorizar las notificaciones."
    : (email.value && !email.validity.valid ? "Escribe un correo electrónico válido." : "");
  const phoneMessage = smsNotificationsEnabled && !phone.value.trim()
    ? "Agrega un teléfono para autorizar los mensajes de texto."
    : "";
  const birthdayMessage = birthdayEmailEnabled && !emailNotificationsEnabled
    ? "Autoriza primero las notificaciones por correo electrónico."
    : "";
  const insuranceCompanyMessage = insured && !insuranceCompany.value.trim() ? "Indica la compañía de seguro." : "";
  const insuranceMemberIdMessage = insured && !insuranceMemberId.value.trim() ? "Indica el ID de miembro o póliza." : "";

  setFieldError(name, $("#patientNameError"), trimmedName.length < 2 ? "Escribe el nombre completo del paciente." : "");
  setFieldError(age, $("#patientAgeError"), ageNumber !== null && (ageNumber < 0 || ageNumber > 120) ? "La edad debe estar entre 0 y 120 años." : "");
  setFieldError(birthDate, $("#patientBirthDateError"), birthDateMessage);
  setFieldError(phone, $("#patientPhoneError"), phoneMessage);
  setFieldError(email, $("#patientEmailError"), emailMessage || birthdayMessage);
  setFieldError(insuranceCompany, $("#patientInsuranceCompanyError"), insuranceCompanyMessage);
  setFieldError(insuranceMemberId, $("#patientInsuranceMemberIdError"), insuranceMemberIdMessage);
  return trimmedName.length >= 2 && !birthDateMessage && !phoneMessage && !emailMessage && !birthdayMessage && !insuranceCompanyMessage && !insuranceMemberIdMessage && (ageNumber === null || (ageNumber >= 0 && ageNumber <= 120));
}

function validateVisitForm() {
  const total = Number($("#visitTotal").value || 0);
  const patientPaid = Number($("#visitPaid").value || 0);
  const insurancePaid = $("#visitPaymentType").value === "insurance" ? Number($("#visitInsurancePaid").value || 0) : 0;
  const reason = $("#visitReason");
  const items = collectVisitLineItems();
  const itemRows = [...$("#visitLineItems").querySelectorAll(".service-line")];
  const invalidItems = items.some((item, index) => {
    const rawPrice = itemRows[index]?.querySelector(".service-price").value;
    return !item.description || rawPrice === "" || !Number.isFinite(item.price) || item.price < 0 || item.quantity < 1;
  });
  const itemsMessage = invalidItems ? "Completa la descripción y el precio de cada servicio." : "";
  const paidMessage = patientPaid + insurancePaid > total ? "Los pagos no pueden ser mayores que el total." : "";
  const reasonMessage = reason.value.trim().length < 3 ? "Describe brevemente el motivo de la consulta." : "";

  setFieldError($("#visitPaid"), $("#visitPaidError"), paidMessage);
  setFieldError(reason, $("#visitReasonError"), reasonMessage);
  $("#visitLineItemsError").textContent = itemsMessage;
  $("#visitLineItemsError").classList.toggle("visible", Boolean(itemsMessage));
  return !paidMessage && !reasonMessage && !itemsMessage;
}

function editPatient(id) {
  const p = state.patients.find((item) => item.id === id);
  if (p) openPatientDialog(p);
}

async function deletePatient(id) {
  if (!confirm("¿Eliminar este paciente y sus consultas relacionadas?")) return;
  try {
    await deletePatientEntry(id);
    render();
    toast("Paciente eliminado");
  } catch (error) {
    console.error(error);
    toast("No se pudo eliminar el paciente");
  }
}

function editVisit(id) {
  const visit = state.visits.find((item) => item.id === id);
  if (visit) openVisitDialog(visit);
}

async function deleteVisit(id) {
  if (!confirm("¿Eliminar esta consulta?")) return;
  try {
    await deleteVisitEntry(id);
    render();
    toast("Consulta eliminada");
  } catch (error) {
    console.error(error);
    toast("No se pudo eliminar la consulta");
  }
}

window.editPatient = editPatient;
window.deletePatient = deletePatient;
window.editVisit = editVisit;
window.deleteVisit = deleteVisit;
window.openInvoice = openInvoice;
window.downloadInvoicePdf = downloadInvoicePdf;
window.printBillingReport = printBillingReport;
window.downloadBillingPdf = downloadBillingPdf;
window.openAppointmentDialog = openAppointmentDialog;
window.editAppointment = editAppointment;
window.deleteAppointment = deleteAppointment;
window.cancelAppointment = cancelAppointment;
window.openAppointmentAt = openAppointmentAt;
window.showAppointmentDay = showAppointmentDay;
window.setAppointmentStatus = setAppointmentStatus;
window.startAppointmentVisit = startAppointmentVisit;
window.openPaymentDialog = openPaymentDialog;
window.openPatientFinance = openPatientFinance;
window.deleteClinicDocument = deleteClinicDocument;
window.openSignatureDialog = openSignatureDialog;
window.selectSignatureDocument = selectSignatureDocument;
window.closeVisitWorkspace = closeVisitWorkspace;

// El expediente de consulta vive dentro del área principal, no como ventana emergente.
$(".main").appendChild($("#visitDialog"));

$$(".nav-item").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
$$("[data-go]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.go)));
$$("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
});

function showAuthForm(name) {
  $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === name));
  $("#loginForm").classList.toggle("active", name === "login");
  $("#registerForm").classList.toggle("active", name === "register");
  const firstInput = name === "login" ? $("#loginEmail") : $("#registerEmail");
  requestAnimationFrame(() => firstInput.focus());
}

$$("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => showAuthForm(button.dataset.authTab));
});

$("#quickPatientBtn").addEventListener("click", () => openPatientDialog());
$("#dashNewPatient").addEventListener("click", () => openPatientDialog());
$("#patientCreateBtn").addEventListener("click", () => openPatientDialog());
$("#appointmentCreateBtn").addEventListener("click", () => openAppointmentDialog());

$("#quickVisitBtn").addEventListener("click", () => openVisitDialog());
$("#dashNewAppointment").addEventListener("click", () => openAppointmentDialog());
$("#dashNewVisit").addEventListener("click", () => openVisitDialog());
$("#visitCreateBtn").addEventListener("click", () => openVisitDialog());

$("#patientSearch").addEventListener("input", renderPatients);
$("#visitSearch").addEventListener("input", renderVisits);
$("#invoiceSearch").addEventListener("input", renderInvoices);
$("#invoicePatientFilter").addEventListener("change", renderInvoices);
$("#billingSearch").addEventListener("input", renderBilling);
$("#billingStatusFilter").addEventListener("change", renderBilling);
$("#billingDateFrom").addEventListener("change", renderBilling);
$("#billingDateTo").addEventListener("change", renderBilling);
$("#billingInsuranceFilter").addEventListener("change", renderBilling);
$("#quickPaymentBtn").addEventListener("click", () => openPaymentDialog());
$("#printBillingBtn").addEventListener("click", printBillingReport);
$("#downloadBillingPdfBtn").addEventListener("click", downloadBillingPdf);
$("#paymentVisit").addEventListener("change", updatePaymentContext);
$("#patientFinancePaymentBtn").addEventListener("click", () => {
  $("#patientFinanceDialog").close();
  openPaymentDialog("", activeFinancePatientId);
});
$$('[data-billing-tab]').forEach((button) => button.addEventListener("click", () => {
  activeBillingTab = button.dataset.billingTab;
  $$('[data-billing-tab]').forEach((tab) => tab.classList.toggle("active", tab === button));
  renderBilling();
}));
$("#downloadInvoiceBtn").addEventListener("click", () => downloadInvoicePdf());

$("#appointmentSearch").addEventListener("input", renderAppointments);
$("#appointmentStatusFilter").addEventListener("change", renderAppointments);
$("#appointmentDoctorFilter").addEventListener("change", renderAppointments);
$("#appointmentDateFilter").addEventListener("change", renderAppointments);
$$('[data-appointment-view]').forEach((button) => button.addEventListener("click", () => {
  appointmentView = button.dataset.appointmentView;
  localStorage.setItem("clinicAppointmentView", appointmentView);
  renderAppointments();
}));
$("#appointmentToday").addEventListener("click", () => { $("#appointmentDateFilter").value = localDateValue(); renderAppointments(); });
function shiftAppointmentDay(days) {
  const value = $("#appointmentDateFilter").value || localDateValue();
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + (appointmentView === "week" ? days * 7 : days));
  $("#appointmentDateFilter").value = localDateValue(date);
  renderAppointments();
}
$("#appointmentPrevDay").addEventListener("click", () => shiftAppointmentDay(-1));
$("#appointmentNextDay").addEventListener("click", () => shiftAppointmentDay(1));

$("#globalSearch").addEventListener("input", (event) => {
  const value = event.target.value.trim();
  if (!value) return;

  $("#patientSearch").value = value;
  showPage("patients");
});

$("#patientName").addEventListener("input", validatePatientForm);
$("#patientAge").addEventListener("input", validatePatientForm);
$("#patientPhone").addEventListener("input", validatePatientForm);
$("#patientEmail").addEventListener("input", validatePatientForm);
$("#patientEmailNotifications").addEventListener("change", validatePatientForm);
$("#patientSmsNotifications").addEventListener("change", validatePatientForm);
$("#patientBirthdayEmail").addEventListener("change", validatePatientForm);
$("#patientPayerType").addEventListener("change", () => {
  togglePatientInsuranceFields();
  validatePatientForm();
});
$("#patientInsuranceCompany").addEventListener("input", validatePatientForm);
$("#patientInsuranceMemberId").addEventListener("input", validatePatientForm);
$("#patientBirthDate").addEventListener("change", () => {
  const calculatedAge = ageFromBirthDate($("#patientBirthDate").value);
  if (calculatedAge !== "" && calculatedAge >= 0) $("#patientAge").value = calculatedAge;
  validatePatientForm();
});
$("#visitPaid").addEventListener("input", validateVisitForm);
$("#visitInsurancePaid").addEventListener("input", validateVisitForm);
$("#visitPaymentType").addEventListener("change", () => { toggleVisitInsuranceFields(); validateVisitForm(); });
$("#visitPatient").addEventListener("change", () => {
  if (!$("#visitId").value) {
    $("#visitPaymentType").value = patient($("#visitPatient").value)?.payerType === "insurance" ? "insurance" : "cash";
    toggleVisitInsuranceFields();
  }
  renderVisitPatientBanner();
});
$("#visitTotal").addEventListener("input", validateVisitForm);
$("#visitReason").addEventListener("input", validateVisitForm);
$("#addVisitLineItem").addEventListener("click", () => {
  renderVisitLineItems([...collectVisitLineItems(), { id: uid(), description: "", price: "" }]);
  $("#visitLineItems .service-line:last-child .service-description").focus();
});

$("#appointmentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#appointmentId").value || uid();
  const existing = state.appointments.find((item) => item.id === id);
  const data = {
    id,
    patientId: $("#appointmentPatient").value,
    date: $("#appointmentDate").value,
    duration: Number($("#appointmentDuration").value || 30),
    type: $("#appointmentType").value,
    doctor: $("#appointmentDoctor").value.trim(),
    status: $("#appointmentStatus").value,
    reason: $("#appointmentReason").value.trim(),
    reminderEnabled: $("#appointmentReminder").checked,
    notes: $("#appointmentNotes").value.trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visitId: existing?.visitId || ""
  };
  if (!data.patientId || !data.date || data.reason.length < 2) { toast("Completa paciente, fecha y motivo."); return; }
  const conflict = findAppointmentConflict(data);
  if (conflict) {
    const conflictPatient = patient(conflict.patientId);
    toast(`Horario ocupado por ${conflictPatient?.name || "otra cita"}.`);
    return;
  }
  try { await saveAppointment(data); $("#appointmentDialog").close(); $("#appointmentDateFilter").value = data.date.slice(0, 10); renderAppointments(); toast(existing ? "Cita actualizada" : "Cita programada"); } catch (error) { console.error(error); toast("No se pudo guardar la cita"); }
});

$("#paymentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const visit = state.visits.find((item) => item.id === $("#paymentVisit").value);
  const amount = Number($("#paymentAmount").value || 0);
  const message = !visit ? "Selecciona una factura." : amount <= 0 ? "Indica un monto mayor que cero." : amount > balance(visit) ? "El pago no puede superar el balance pendiente." : "";
  setFieldError($("#paymentAmount"), $("#paymentAmountError"), message);
  if (message) return;
  const entry = { id: uid(), visitId: visit.id, patientId: visit.patientId, source: $("#paymentSource").value, amount, method: $("#paymentMethod").value, date: $("#paymentDate").value, reference: $("#paymentReference").value.trim(), note: $("#paymentNote").value.trim(), createdAt: new Date().toISOString() };
  try {
    await registerPayment(entry, visit);
    const sourceField = entry.source === "insurance" ? "insurancePaid" : "patientPaid";
    visit[sourceField] = Number(visit[sourceField] || 0) + entry.amount;
    visit.paid = Number(visit.patientPaid || 0) + Number(visit.insurancePaid || 0);
    state.payments = [...state.payments.filter((item) => item.id !== entry.id), entry];
    renderVisitPaymentPanel(visit);
    $("#paymentDialog").close();
    toast("Pago aplicado correctamente");
  } catch (error) { console.error(error); toast("No se pudo registrar el pago"); }
});

$("#patientForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!validatePatientForm()) return;

  const id = $("#patientId").value;
  const data = {
    id: id || uid(),
    name: $("#patientName").value.trim(),
    phone: $("#patientPhone").value.trim(),
    email: $("#patientEmail").value.trim().toLowerCase(),
    age: $("#patientAge").value,
    birthDate: $("#patientBirthDate").value,
    language: $("#patientLanguage").value,
    payerType: $("#patientPayerType").value,
    insuranceCompany: $("#patientPayerType").value === "insurance" ? $("#patientInsuranceCompany").value.trim() : "",
    insuranceMemberId: $("#patientPayerType").value === "insurance" ? $("#patientInsuranceMemberId").value.trim() : "",
    insuranceGroup: $("#patientPayerType").value === "insurance" ? $("#patientInsuranceGroup").value.trim() : "",
    emailNotificationsEnabled: $("#patientEmailNotifications").checked,
    smsNotificationsEnabled: $("#patientSmsNotifications").checked,
    birthdayEmailEnabled: $("#patientBirthdayEmail").checked,
    document: $("#patientDocument").value.trim(),
    notes: $("#patientNotes").value.trim(),
    createdAt: id ? state.patients.find((p) => p.id === id)?.createdAt : new Date().toISOString()
  };

  try {
    await savePatient(data);
    $("#patientDialog").close();
    render();
    toast(id ? "Paciente actualizado" : "Paciente registrado");
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar el paciente");
  }
});

$("#visitForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const total = Number($("#visitTotal").value || 0);
  const patientPaid = Number($("#visitPaid").value || 0);
  const insurancePaid = $("#visitPaymentType").value === "insurance" ? Number($("#visitInsurancePaid").value || 0) : 0;

  if (!validateVisitForm()) return;

  const id = $("#visitId").value;
  const recordId = id || uid();
  const existingVisit = state.visits.find((visit) => visit.id === id);
  const lineItems = collectVisitLineItems();
  const data = {
    id: recordId,
    patientId: $("#visitPatient").value,
    type: $("#visitType").value,
    date: $("#visitDate").value,
    doctor: $("#visitDoctor").value.trim(),
    status: $("#visitStatus").value,
    reminderEnabled: $("#visitReminderEnabled").checked,
    reason: $("#visitReason").value.trim(),
    notes: $("#visitNotes").value.trim(),
    lineItems,
    invoiceNumber: existingVisit?.invoiceNumber || `${state.settings.invoicePrefix || "FAC"}-${recordId.slice(0, 8).toUpperCase()}`,
    total,
    paid: patientPaid + insurancePaid,
    patientPaid,
    insurancePaid,
    paymentType: $("#visitPaymentType").value,
    claimStatus: $("#visitPaymentType").value === "insurance" ? $("#visitClaimStatus").value : "",
    claimNumber: $("#visitPaymentType").value === "insurance" ? $("#visitClaimNumber").value.trim() : "",
    copay: $("#visitPaymentType").value === "insurance" ? Number($("#visitCopay").value || 0) : 0,
    appointmentId: existingVisit?.appointmentId || pendingAppointmentId || "",
    documents: collectVisitDocuments(existingVisit?.documents)
  };

  try {
    await saveVisit(data);
    if (data.appointmentId) {
      const appointment = state.appointments.find((item) => item.id === data.appointmentId);
      if (appointment) await saveAppointment({ ...appointment, status: "completed", visitId: data.id, updatedAt: new Date().toISOString() });
    }
    pendingAppointmentId = null;
    showPage("visits");
    render();
    toast(id ? "Consulta actualizada" : "Consulta registrada");
  } catch (error) {
    console.error(error);
    toast("No se pudo guardar la consulta");
  }
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  state.settings = {
    ...state.settings,
    clinicName: $("#clinicName").value.trim(),
    clinicAddress: $("#clinicAddress").value.trim(),
    clinicPhone: $("#clinicPhone").value.trim(),
    clinicEmail: $("#clinicEmail").value.trim(),
    invoicePrefix: ($("#invoicePrefix").value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") || "FAC"),
    invoiceAccentColor: $("#invoiceAccentColor").value,
    invoiceLogoPosition: $("#invoiceLogoPosition").value,
    invoiceFooter: $("#invoiceFooter").value.trim(),
    invoiceShowAddress: $("#invoiceShowAddress").checked,
    invoiceShowPhone: $("#invoiceShowPhone").checked,
    invoiceShowEmail: $("#invoiceShowEmail").checked,
    invoiceShowDoctor: $("#invoiceShowDoctor").checked,
    invoiceShowInsurance: $("#invoiceShowInsurance").checked
  };

  try {
    await saveSettings();
    render();
    toast("Ajustes guardados");
  } catch (error) {
    console.error(error);
    toast("No se pudieron guardar los ajustes");
  }
});

$("#clinicLogoInput").addEventListener("change", async (event) => {
  try {
    state.settings.clinicLogo = await readLogoFile(event.target.files[0]);
    renderSettings();
    toast("Logo listo. Guarda los cambios para conservarlo.");
  } catch (error) {
    event.target.value = "";
    toast(error.message);
  }
});

$("#clinicDocumentInput").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    event.target.disabled = true;
    for (const file of files) await uploadClinicDocument(file);
    toast(`${files.length} documento(s) cargado(s)`);
  } catch (error) {
    console.error(error);
    toast(error.message || "No se pudieron subir los documentos");
  } finally {
    event.target.disabled = false;
    event.target.value = "";
  }
});

$("#clearSignatureBtn").addEventListener("click", clearSignatureCanvas);
$("#saveSignatureBtn").addEventListener("click", saveCurrentSignature);

(() => {
  const canvas = $("#signatureCanvas");
  let drawing = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const context = canvas.getContext("2d");
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const current = point(event);
    const context = canvas.getContext("2d");
    context.lineTo(current.x, current.y);
    context.stroke();
    signatureHasInk = true;
    event.preventDefault();
  });
  const stopDrawing = () => { drawing = false; };
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
})();

$("#removeClinicLogo").addEventListener("click", () => {
  state.settings.clinicLogo = "";
  $("#clinicLogoInput").value = "";
  renderSettings();
  toast("Logo removido. Guarda los cambios.");
});

["clinicName", "invoicePrefix", "invoiceAccentColor", "invoiceLogoPosition", "invoiceFooter"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderInvoiceStylePreview);
  document.getElementById(id).addEventListener("change", renderInvoiceStylePreview);
});

$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clinic-control-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

$("#logoutBtn").addEventListener("click", async () => {
  if (!auth) return;
  await auth.signOut();
  unsubscribeAll();
  clearState();
  showAuthScreen();
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;

  if (!email || !password) {
    toast("Ingresa correo y contraseña.");
    return;
  }

  try {
    initFirebase();
    await auth.signInWithEmailAndPassword(email, password);
    toast("Sesión iniciada");
  } catch (error) {
    console.error(error);
    toast(getAuthErrorMessage(error));
  }
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const clinicName = $("#registerClinicName").value.trim();
  const clinicAddress = $("#registerClinicAddress").value.trim();
  const clinicPhone = $("#registerClinicPhone").value.trim();
  const email = $("#registerEmail").value.trim().toLowerCase();
  const password = $("#registerPassword").value;
  const confirm = $("#registerConfirm").value;

  if (!clinicName || !clinicAddress || !clinicPhone || !email || !password || !confirm) {
    toast("Completa todos los campos de registro.");
    return;
  }

  if (clinicName.length < 2) {
    toast("Escribe un nombre válido para la clínica.");
    return;
  }

  if (password !== confirm) {
    toast("Las contraseñas no coinciden.");
    return;
  }

  if (password.length < 6) {
    toast("La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  try {
    const clinicLogo = await readLogoFile($("#registerClinicLogo").files[0]);
    initFirebase();
    const credential = await auth.createUserWithEmailAndPassword(email, password);
    await firestore.collection("clinics").doc(credential.user.uid).collection("settings").doc("clinic").set({
      clinicName,
      clinicAddress,
      clinicPhone,
      clinicEmail: email,
      clinicLogo,
      senderEmail: email,
      invoicePrefix: "FAC",
      invoiceAccentColor: "#0f766e",
      invoiceLogoPosition: "left",
      invoiceFooter: "Gracias por confiar en nuestra clínica.",
      invoiceShowAddress: true,
      invoiceShowPhone: true,
      invoiceShowEmail: true,
      invoiceShowDoctor: true,
      invoiceShowInsurance: true
    }, { merge: true });
    state.settings = { ...state.settings, clinicName, clinicAddress, clinicPhone, clinicEmail: email, clinicLogo };
    render();
    toast("Cuenta creada. Bienvenido.");
  } catch (error) {
    console.error(error);
    toast(getAuthErrorMessage(error, "register"));
  }
});

$("#loginShowPassword").addEventListener("change", (event) => {
  $("#loginPassword").type = event.target.checked ? "text" : "password";
});

$("#registerShowPassword").addEventListener("change", (event) => {
  const show = event.target.checked;
  $("#registerPassword").type = show ? "text" : "password";
  $("#registerConfirm").type = show ? "text" : "password";
});

function handleAuthState(user) {
  if (user) {
    updateUserInfo();
    showAppScreen();
    loadClinicData().catch((error) => {
      console.error(error);
      toast("No se pudo cargar datos de la clínica.");
    });
  } else {
    showAuthScreen();
  }
}

(async () => {
  try {
    initFirebase();
    auth.onAuthStateChanged(handleAuthState, (error) => {
      console.error(error);
      toast("Error de autenticación.");
    });
  } catch (error) {
    console.error(error);
    toast("No se pudo inicializar Firebase");
  }
})();
