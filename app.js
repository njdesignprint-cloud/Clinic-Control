let state = { settings: {}, patients: [], visits: [] };
let firestore = null;
let auth = null;
let unsubscribe = null;

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildSeedState() {
  const patients = [
    {
      id: uid(),
      name: "Oscar Arrate Fernandez",
      phone: "5029997421",
      age: 37,
      document: "P-1001",
      notes: "Paciente activo.",
      createdAt: "2026-07-03T20:49"
    },
    {
      id: uid(),
      name: "Maria Perez",
      phone: "35624546",
      age: "",
      document: "P-1002",
      notes: "",
      createdAt: "2026-06-20T23:09"
    },
    {
      id: uid(),
      name: "Pedro Perez Garcia",
      phone: "8325135901",
      age: 46,
      document: "P-1003",
      notes: "Saldo pendiente.",
      createdAt: "2026-06-15T19:26"
    }
  ];

  return {
    settings: {
      clinicName: "Clinic Control",
      clinicAddress: "Dirección de la clínica",
      clinicPhone: "(000) 000-0000",
      clinicEmail: "admin@clinic.com"
    },
    patients,
    visits: [
      {
        id: uid(),
        patientId: patients[0].id,
        type: "Presencial",
        date: "2026-07-03T20:49",
        doctor: "Dr. Admin",
        reason: "Consulta general",
        notes: "Sin observaciones.",
        total: 25,
        paid: 25
      },
      {
        id: uid(),
        patientId: patients[1].id,
        type: "Presencial",
        date: "2026-06-20T23:09",
        doctor: "Dr. Admin",
        reason: "Chequeo",
        notes: "",
        total: 500,
        paid: 500
      },
      {
        id: uid(),
        patientId: patients[2].id,
        type: "Teleconsulta",
        date: "2026-06-15T19:26",
        doctor: "Dr. Admin",
        reason: "Seguimiento médico",
        notes: "Pendiente de pago.",
        total: 500,
        paid: 200
      }
    ]
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

  if (!firebase.apps.length) {
    firebase.initializeApp(window.firebaseConfig);
  }

  firestore = firebase.firestore();
  auth = firebase.auth();
  firestore.settings({ experimentalAutoDetectLongPolling: true });

  try {
    firestore.enablePersistence({ synchronizeTabs: true });
  } catch (error) {
    console.warn("Persistencia offline no disponible:", error);
  }

  return { firestore, auth };
}

async function ensureAuth() {
  if (!auth) {
    initFirebase();
  }

  if (!auth.currentUser) {
    await auth.signInAnonymously();
  }
}

function getCollectionRef(collectionName) {
  if (!firestore) {
    initFirebase();
  }
  return firestore.collection(collectionName);
}

async function seedFirebase() {
  const seed = buildSeedState();
  const batch = firestore.batch();
  batch.set(getCollectionRef("settings").doc("clinic"), seed.settings, { merge: true });

  seed.patients.forEach((patient) => {
    batch.set(getCollectionRef("patients").doc(patient.id), patient, { merge: true });
  });

  seed.visits.forEach((visit) => {
    batch.set(getCollectionRef("visits").doc(visit.id), visit, { merge: true });
  });

  await batch.commit();
}

function subscribeToRealtime() {
  if (unsubscribe) {
    unsubscribe();
  }

  const settingsRef = getCollectionRef("settings").doc("clinic");
  const patientsRef = getCollectionRef("patients");
  const visitsRef = getCollectionRef("visits");

  unsubscribe = () => {
    settingsRef.onSnapshot(() => {});
    patientsRef.onSnapshot(() => {});
    visitsRef.onSnapshot(() => {});
  };

  settingsRef.onSnapshot((doc) => {
    if (doc.exists) {
      state.settings = doc.data() || {};
      render();
    }
  });

  patientsRef.onSnapshot((snapshot) => {
    state.patients = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    render();
  });

  visitsRef.onSnapshot((snapshot) => {
    state.visits = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    render();
  });
}

async function load() {
  try {
    await ensureAuth();

    const [settingsDoc, patientsSnap, visitsSnap] = await Promise.all([
      getCollectionRef("settings").doc("clinic").get(),
      getCollectionRef("patients").get(),
      getCollectionRef("visits").get()
    ]);

    if (!settingsDoc.exists && patientsSnap.empty && visitsSnap.empty) {
      await seedFirebase();
      state = buildSeedState();
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
  } catch (error) {
    console.error(error);
    state = normalizeState(null);
  }
}

async function save() {
  await ensureAuth();
  await getCollectionRef("settings").doc("clinic").set(state.settings, { merge: true });
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
  await getCollectionRef("settings").doc("clinic").set(state.settings, { merge: true });
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
    return `
      <div class="timeline-item">
        <div class="timeline-icon">${visit.type === "Teleconsulta" ? "T" : "P"}</div>
        <div>
          <strong>${p?.name || "Paciente eliminado"}</strong>
          <span>${visit.reason} · ${fmtDate(visit.date)}</span>
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
  const rows = state.patients.filter((p) => `${p.name} ${p.phone} ${p.document}`.toLowerCase().includes(query));

  $("#patientsTable").innerHTML = rows.length ? rows.map((p) => `
    <tr>
      <td><strong>${p.name}</strong><br><small>${p.notes || "Sin notas"}</small></td>
      <td>${p.phone || "-"}</td>
      <td>${p.age || "-"}</td>
      <td>${p.document || "-"}</td>
      <td>${fmtDate(p.createdAt)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" onclick="editPatient('${p.id}')" title="Editar">✎</button>
          <button class="icon-btn" onclick="deletePatient('${p.id}')" title="Eliminar">⌫</button>
        </div>
      </td>
    </tr>
  `).join("") : `<tr><td class="empty" colspan="6">No se encontraron pacientes.</td></tr>`;
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
        <td><span class="badge ${visit.type === "Teleconsulta" ? "blue" : "green"}">${visit.type}</span></td>
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
  $("#clinicName").value = state.settings.clinicName || "";
  $("#clinicAddress").value = state.settings.clinicAddress || "";
  $("#clinicPhone").value = state.settings.clinicPhone || "";
  $("#clinicEmail").value = state.settings.clinicEmail || "";
}

function openPatientDialog(p = null) {
  $("#patientDialogTitle").textContent = p ? "Editar paciente" : "Nuevo paciente";
  $("#patientId").value = p?.id || "";
  $("#patientName").value = p?.name || "";
  $("#patientPhone").value = p?.phone || "";
  $("#patientAge").value = p?.age || "";
  $("#patientDocument").value = p?.document || "";
  $("#patientNotes").value = p?.notes || "";
  $("#patientDialog").showModal();
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
  $("#visitTotal").value = visit?.total ?? "";
  $("#visitPaid").value = visit?.paid ?? 0;
  $("#visitReason").value = visit?.reason || "";
  $("#visitNotes").value = visit?.notes || "";
  $("#visitDialog").showModal();
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

$$(".nav-item").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
$$("[data-go]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.go)));
$$("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
});

$("#quickPatientBtn").addEventListener("click", () => openPatientDialog());
$("#dashNewPatient").addEventListener("click", () => openPatientDialog());
$("#patientCreateBtn").addEventListener("click", () => openPatientDialog());

$("#quickVisitBtn").addEventListener("click", () => openVisitDialog());
$("#dashNewVisit").addEventListener("click", () => openVisitDialog());
$("#visitCreateBtn").addEventListener("click", () => openVisitDialog());

$("#patientSearch").addEventListener("input", renderPatients);
$("#visitSearch").addEventListener("input", renderVisits);

$("#globalSearch").addEventListener("input", (event) => {
  const value = event.target.value.trim();
  if (!value) return;

  $("#patientSearch").value = value;
  showPage("patients");
});

$("#patientForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const id = $("#patientId").value;
  const data = {
    id: id || uid(),
    name: $("#patientName").value.trim(),
    phone: $("#patientPhone").value.trim(),
    age: $("#patientAge").value,
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

  if (paid > total) {
    toast("El pago no puede ser mayor al total.");
    return;
  }

  const id = $("#visitId").value;
  const data = {
    id: id || uid(),
    patientId: $("#visitPatient").value,
    type: $("#visitType").value,
    date: $("#visitDate").value,
    doctor: $("#visitDoctor").value.trim(),
    reason: $("#visitReason").value.trim(),
    notes: $("#visitNotes").value.trim(),
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

(async () => {
  try {
    await load();
    render();
  } catch (error) {
    console.error(error);
    toast("No se pudo conectar con Firebase");
  }
})();
