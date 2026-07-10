const DEFAULT_SETTINGS = {
  clinicName: "Clinic Control",
  clinicAddress: "Dirección de la clínica",
  clinicPhone: "(000) 000-0000",
  clinicEmail: "admin@clinic.com"
};

function uid() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
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
    settings: { ...DEFAULT_SETTINGS },
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

function normalizeState(value) {
  const seed = buildSeedState();
  const settings = value?.settings || {};

  return {
    settings: {
      clinicName: settings.clinicName || seed.settings.clinicName,
      clinicAddress: settings.clinicAddress || seed.settings.clinicAddress,
      clinicPhone: settings.clinicPhone || seed.settings.clinicPhone,
      clinicEmail: settings.clinicEmail || seed.settings.clinicEmail
    },
    patients: Array.isArray(value?.patients) ? value.patients : seed.patients,
    visits: Array.isArray(value?.visits) ? value.visits : seed.visits
  };
}

export { DEFAULT_SETTINGS, buildSeedState, normalizeState, uid };
