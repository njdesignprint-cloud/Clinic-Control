let state = { settings: {}, patients: [], visits: [] };
let firestore = null;
let auth = null;
let unsubscribeSettings = null;
let unsubscribePatients = null;
let unsubscribeVisits = null;
let activeInvoiceId = null;

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
      clinicEmail: ""
    },
    patients: [],
    visits: []
  };
}

function normalizeState(saved) {
  const seed = buildSeedState();
  return {
    settings: {
      clinicName: saved?.settings?.clinicName || seed.settings.clinicName,
      clinicAddress: saved?.settings?.clinicAddress || seed.settings.clinicAddress,
      clinicPhone: saved?.settings?.clinicPhone || seed.settings.clinicPhone,
      clinicEmail: saved?.settings?.clinicEmail || seed.settings.clinicEmail
    },
    patients: Array.isArray(saved?.patients) ? saved.patients : seed.patients,
    visits: Array.isArray(saved?.visits) ? saved.visits : seed.visits
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

  return { firestore, auth };
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
  unsubscribeSettings = null;
  unsubscribePatients = null;
  unsubscribeVisits = null;
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
  state = { settings: {}, patients: [], visits: [] };
  render();
}

function subscribeToRealtime() {
  unsubscribeAll();

  const settingsRef = getClinicDocRef().collection("settings").doc("clinic");
  const patientsRef = getCollectionRef("patients");
  const visitsRef = getCollectionRef("visits");

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

async function saveSettings() {
  await ensureAuth();
  await getClinicDocRef().collection("settings").doc("clinic").set(state.settings, { merge: true });
}

async function deletePatientEntry(id) {
  await ensureAuth();
  const visitSnap = await getCollectionRef("visits").where("patientId", "==", id).get();
  const batch = firestore.batch();
  batch.delete(getCollectionRef("patients").doc(id));
  visitSnap.docs.forEach((doc) => batch.delete(getCollectionRef("visits").doc(doc.id)));
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
  return visit.invoiceNumber || `FAC-${String(visit.id || "").slice(0, 8).toUpperCase()}`;
}

function visitItems(visit) {
  if (Array.isArray(visit?.lineItems) && visit.lineItems.length) return visit.lineItems;
  if (Number(visit?.total || 0) > 0) {
    return [{ id: uid(), description: visit.reason || "Consulta", price: Number(visit.total) }];
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
  return Math.max(0, Number(visit.total || 0) - Number(visit.paid || 0));
}

function totals(visits = state.visits) {
  return visits.reduce((acc, visit) => {
    acc.billed += Number(visit.total || 0);
    acc.paid += Number(visit.paid || 0);
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
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === pageId));

  const labels = {
    dashboard: "Dashboard",
    patients: "Pacientes",
    visits: "Consultas",
    billing: "Cobros",
    invoices: "Facturas",
    reports: "Reportes",
    settings: "Ajustes"
  };

  $("#pageTitle").textContent = labels[pageId] || "Clinic Control";
  render();
}

function render() {
  renderDashboard();
  renderPatients();
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
  const rows = state.patients.filter((p) => `${p.name} ${p.phone} ${p.email || ""} ${p.document} ${p.language || ""}`.toLowerCase().includes(query));

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
          <button class="icon-btn" onclick="deletePatient('${p.id}')" title="Eliminar">⌫</button>
        </div>
      </td>
    </tr>
  `).join("") : `<tr><td class="empty" colspan="7">No se encontraron pacientes.</td></tr>`;
}

function renderVisitOptions() {
  $("#visitPatient").innerHTML = state.patients.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
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
    return `
      <tr>
        <td>${fmtDate(visit.date)}</td>
        <td><strong>${p?.name || "Paciente eliminado"}</strong><br><small>${visit.doctor || "Sin doctor asignado"}</small></td>
        <td><span class="badge ${visit.type === "Teleconsulta" ? "blue" : "green"}">${visit.type}</span><br><small>${visit.status || "Completada"}</small></td>
        <td>${visit.reason}</td>
        <td>${money(visit.total)}</td>
        <td>${money(visit.paid)}</td>
        <td><span class="badge ${due > 0 ? "red" : "green"}">${money(due)}</span></td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" onclick="editVisit('${visit.id}')" title="Editar">✎</button>
            <button class="icon-btn" onclick="deleteVisit('${visit.id}')" title="Eliminar">⌫</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td class="empty" colspan="8">No hay consultas registradas.</td></tr>`;
}

function renderBilling() {
  const rows = debtRows();
  const box = $("#billingCards");

  if (!rows.length) {
    box.innerHTML = `<div class="empty">No hay deudas pendientes.</div>`;
    return;
  }

  box.innerHTML = rows.map((row) => `
    <article class="billing-card">
      <div class="top">
        <div>
          <h3>${row.patient.name}</h3>
          <p>${row.patient.phone || "Sin teléfono"} · ${row.visits.length} consulta(s) pendiente(s)</p>
        </div>
        <strong class="balance">${money(row.debt)}</strong>
      </div>

      <div class="billing-details">
        ${row.visits.map((visit) => `
          <div>
            <span>${fmtDate(visit.date)}</span>
            <strong>${money(balance(visit))}</strong>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
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
        <td>${money(visit.paid)}</td>
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
  activeInvoiceId = id;
  $("#invoiceDialogTitle").textContent = invoiceNumber(visit);
  $("#invoiceDetail").innerHTML = `
    <article class="invoice-sheet">
      <header>
        <div><h2>${escapeHtml(state.settings.clinicName || "Clinic Control")}</h2><p>${escapeHtml(state.settings.clinicAddress || "")}</p></div>
        <div class="invoice-heading"><strong>FACTURA</strong><span>${escapeHtml(invoiceNumber(visit))}</span></div>
      </header>
      <div class="invoice-meta">
        <div><small>Paciente</small><strong>${escapeHtml(p?.name || "Paciente eliminado")}</strong><span>${escapeHtml(p?.phone || "")}</span><span>${escapeHtml(payerLabel(p))}</span></div>
        <div><small>Fecha</small><strong>${fmtDate(visit.date)}</strong><span>${escapeHtml(visit.doctor || "Sin doctor asignado")}</span></div>
      </div>
      <table class="invoice-items">
        <thead><tr><th>Descripción del servicio</th><th>Precio</th></tr></thead>
        <tbody>${items.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${money(item.price)}</td></tr>`).join("")}</tbody>
      </table>
      <div class="invoice-summary">
        <div><span>Total</span><strong>${money(visit.total)}</strong></div>
        <div><span>Pagado</span><strong>${money(visit.paid)}</strong></div>
        <div class="invoice-balance"><span>Balance</span><strong>${money(due)}</strong></div>
      </div>
      ${visit.notes ? `<div class="invoice-notes"><strong>Notas</strong><p>${escapeHtml(visit.notes)}</p></div>` : ""}
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
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const left = 48;
  const right = 564;
  let y = 52;

  pdf.setTextColor(15, 118, 110);
  pdf.setFontSize(20);
  pdf.setFont("helvetica", "bold");
  pdf.text(state.settings.clinicName || "Clinic Control", left, y);
  pdf.setFontSize(17);
  pdf.text("FACTURA", right, y, { align: "right" });
  y += 22;
  pdf.setTextColor(80, 95, 115);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(state.settings.clinicAddress || "", left, y);
  pdf.text(invoiceNumber(visit), right, y, { align: "right" });
  y += 24;
  pdf.setDrawColor(20, 184, 166);
  pdf.line(left, y, right, y);
  y += 28;

  pdf.setTextColor(23, 32, 51);
  pdf.setFont("helvetica", "bold");
  pdf.text(`Cliente: ${p?.name || "Paciente eliminado"}`, left, y);
  pdf.text(`Fecha: ${fmtDate(visit.date)}`, 320, y);
  y += 17;
  pdf.setFont("helvetica", "normal");
  pdf.text(`Teléfono: ${p?.phone || "No indicado"}`, left, y);
  pdf.text(`Doctor: ${visit.doctor || "No indicado"}`, 320, y);
  y += 17;
  pdf.text(`Responsable de pago: ${payerLabel(p)}`, left, y);
  if (p?.payerType === "insurance" && p.insuranceMemberId) pdf.text(`ID de miembro: ${p.insuranceMemberId}`, 320, y);
  y += 32;

  pdf.setFillColor(241, 245, 249);
  pdf.rect(left, y - 14, right - left, 24, "F");
  pdf.setFont("helvetica", "bold");
  pdf.text("Descripción del servicio", left + 8, y);
  pdf.text("Precio", right - 8, y, { align: "right" });
  y += 26;

  pdf.setFont("helvetica", "normal");
  items.forEach((item) => {
    const lines = pdf.splitTextToSize(item.description || "Servicio", 390);
    const rowHeight = Math.max(22, lines.length * 13 + 8);
    if (y + rowHeight > 700) {
      pdf.addPage();
      y = 52;
    }
    pdf.text(lines, left + 8, y);
    pdf.text(money(item.price), right - 8, y, { align: "right" });
    y += rowHeight;
    pdf.setDrawColor(226, 232, 240);
    pdf.line(left, y - 8, right, y - 8);
  });

  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.text(`Total: ${money(visit.total)}`, right, y, { align: "right" });
  y += 18;
  pdf.text(`Pagado: ${money(visit.paid)}`, right, y, { align: "right" });
  y += 18;
  pdf.setTextColor(balance(visit) > 0 ? 185 : 4, balance(visit) > 0 ? 28 : 120, balance(visit) > 0 ? 28 : 87);
  pdf.text(`Balance: ${money(balance(visit))}`, right, y, { align: "right" });

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
              <td>${money(visit.paid)}</td>
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
  $("#heroClinicTitle").textContent = state.settings.clinicName
    ? `Control diario de ${state.settings.clinicName}`
    : "Control diario de la clínica";
  document.title = `${clinicName} · Clinic Control`;
  $("#clinicName").value = state.settings.clinicName || "";
  $("#clinicAddress").value = state.settings.clinicAddress || "";
  $("#clinicPhone").value = state.settings.clinicPhone || "";
  $("#clinicEmail").value = state.settings.clinicEmail || "";
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

  $("#visitDialogTitle").textContent = visit ? "Editar consulta" : "Nueva consulta";
  $("#visitId").value = visit?.id || "";
  $("#visitPatient").value = visit?.patientId || state.patients[0].id;
  $("#visitType").value = visit?.type || "Presencial";
  $("#visitDate").value = visit?.date || new Date().toISOString().slice(0, 16);
  $("#visitDoctor").value = visit?.doctor || "";
  $("#visitStatus").value = visit?.status || (visit ? "Completada" : "Programada");
  $("#visitReminderEnabled").checked = visit ? Boolean(visit.reminderEnabled) : true;
  renderVisitLineItems(visitItems(visit));
  $("#visitPaid").value = visit?.paid ?? 0;
  $("#visitReason").value = visit?.reason || "";
  $("#visitNotes").value = visit?.notes || "";
  clearFormErrors($("#visitForm"));
  $("#visitDialog").showModal();
  requestAnimationFrame(() => $("#visitPatient").focus());
}

function renderVisitLineItems(items = []) {
  const box = $("#visitLineItems");
  const rows = items.length ? items : [{ id: uid(), description: "", price: "" }];
  box.innerHTML = rows.map((item) => `
    <div class="service-line" data-line-id="${escapeHtml(item.id || uid())}">
      <label class="field-group"><span class="field-label">Servicio o procedimiento</span>
        <input class="service-description" type="text" value="${escapeHtml(item.description)}" placeholder="Ej. Consulta, tratamiento o producto" />
      </label>
      <label class="field-group"><span class="field-label">Precio</span>
        <div class="input-prefix"><span>$</span><input class="service-price" type="number" step="0.01" min="0" value="${item.price ?? ""}" placeholder="0.00" /></div>
      </label>
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
    price: Number(row.querySelector(".service-price").value || 0)
  }));
}

function updateVisitTotal() {
  const total = collectVisitLineItems().reduce((sum, item) => sum + item.price, 0);
  $("#visitTotal").value = total.toFixed(2);
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
  const paid = Number($("#visitPaid").value || 0);
  const reason = $("#visitReason");
  const items = collectVisitLineItems();
  const itemRows = [...$("#visitLineItems").querySelectorAll(".service-line")];
  const invalidItems = items.some((item, index) => {
    const rawPrice = itemRows[index]?.querySelector(".service-price").value;
    return !item.description || rawPrice === "" || !Number.isFinite(item.price) || item.price < 0;
  });
  const itemsMessage = invalidItems ? "Completa la descripción y el precio de cada servicio." : "";
  const paidMessage = paid > total ? "El pago no puede ser mayor que el total." : "";
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

$("#quickVisitBtn").addEventListener("click", () => openVisitDialog());
$("#dashNewVisit").addEventListener("click", () => openVisitDialog());
$("#visitCreateBtn").addEventListener("click", () => openVisitDialog());

$("#patientSearch").addEventListener("input", renderPatients);
$("#visitSearch").addEventListener("input", renderVisits);
$("#invoiceSearch").addEventListener("input", renderInvoices);
$("#invoicePatientFilter").addEventListener("change", renderInvoices);
$("#downloadInvoiceBtn").addEventListener("click", () => downloadInvoicePdf());

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
$("#visitTotal").addEventListener("input", validateVisitForm);
$("#visitReason").addEventListener("input", validateVisitForm);
$("#addVisitLineItem").addEventListener("click", () => {
  renderVisitLineItems([...collectVisitLineItems(), { id: uid(), description: "", price: "" }]);
  $("#visitLineItems .service-line:last-child .service-description").focus();
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
  const paid = Number($("#visitPaid").value || 0);

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
    invoiceNumber: existingVisit?.invoiceNumber || `FAC-${recordId.slice(0, 8).toUpperCase()}`,
    total,
    paid
  };

  try {
    await saveVisit(data);
    $("#visitDialog").close();
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
    clinicName: $("#clinicName").value.trim(),
    clinicAddress: $("#clinicAddress").value.trim(),
    clinicPhone: $("#clinicPhone").value.trim(),
    clinicEmail: $("#clinicEmail").value.trim()
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
  const email = $("#registerEmail").value.trim().toLowerCase();
  const password = $("#registerPassword").value;
  const confirm = $("#registerConfirm").value;

  if (!clinicName || !email || !password || !confirm) {
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
    initFirebase();
    const credential = await auth.createUserWithEmailAndPassword(email, password);
    await firestore.collection("clinics").doc(credential.user.uid).collection("settings").doc("clinic").set({
      clinicName,
      clinicAddress: "",
      clinicPhone: "",
      clinicEmail: email,
      senderEmail: email
    }, { merge: true });
    state.settings = { ...state.settings, clinicName, clinicEmail: email };
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
