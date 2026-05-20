import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

// ── In-memory fallback ────────────────────────────────────────
const memory = {
  enabled: false,
  students: [],
  ppdb_registrations: [],
  ppdb_settings: [],
  attendance: [],
  billing: [],
  tahfidz: [],
  dormitory_rooms: [],
  dormitory_assignments: [],
  permits: [],
  staff: [],
  staff_attendance: [],
  student_violations: [],
  seq: 1
};

let pool;

if (process.env.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

function inMemoryResult(rows = []) {
  return { rows };
}

export async function query(text, params = []) {
  if (!memory.enabled && pool) {
    return pool.query(text, params);
  }

  const normalized = text.trim().toLowerCase();

  if (normalized.startsWith("select 1")) return inMemoryResult([{ "?column?": 1 }]);

  // ── PPDB Settings ────────────────────────────────────────
  if (normalized.includes("select * from ppdb_settings")) {
    return inMemoryResult([...memory.ppdb_settings].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into ppdb_settings")) {
    const [payload, updated_by] = params;
    const row = {
      id: memory.seq++,
      tenant_id: 1,
      payload,
      updated_by: updated_by || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memory.ppdb_settings.push(row);
    return inMemoryResult([row]);
  }

  // ── PPDB Registrations ───────────────────────────────────
  if (normalized.includes("select * from ppdb_registrations")) {
    return inMemoryResult([...memory.ppdb_registrations].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into ppdb_registrations")) {
    const [student_name, origin_school, guardian_name, guardian_phone, notes, source_page] = params;
    const row = {
      id: memory.seq++,
      student_name,
      origin_school,
      guardian_name: guardian_name || null,
      guardian_phone,
      notes: notes || null,
      source_page: source_page || "/ppdb",
      status: "pending",
      verified_by: null,
      verified_at: null,
      created_at: new Date().toISOString()
    };
    memory.ppdb_registrations.push(row);
    return inMemoryResult([row]);
  }
  if (normalized.startsWith("update ppdb_registrations set status")) {
    const [status, verified_by, verified_at, id] = params;
    const idx = memory.ppdb_registrations.findIndex((p) => Number(p.id) === Number(id));
    if (idx === -1) return inMemoryResult([]);
    memory.ppdb_registrations[idx] = {
      ...memory.ppdb_registrations[idx],
      status,
      verified_by: verified_by || null,
      verified_at: verified_at || null
    };
    return inMemoryResult([memory.ppdb_registrations[idx]]);
  }

  // ── Students ──────────────────────────────────────────────
  if (normalized.includes("select * from students")) {
    return inMemoryResult([...memory.students].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into students")) {
    const [nis, full_name, class_name, guardian_name] = params;
    if (memory.students.some((s) => s.nis === nis)) throw new Error("duplicate key value violates unique constraint students_nis");
    const row = { id: memory.seq++, nis, full_name, class_name, guardian_name: guardian_name || null, gender: null, birth_date: null, address: null, status: "aktif", created_at: new Date().toISOString() };
    memory.students.push(row);
    return inMemoryResult([row]);
  }
  if (normalized.startsWith("update students set status")) {
    const [status, id] = params;
    const idx = memory.students.findIndex((s) => Number(s.id) === Number(id));
    if (idx === -1) return inMemoryResult([]);
    memory.students[idx] = { ...memory.students[idx], status };
    return inMemoryResult([memory.students[idx]]);
  }

  // ── Attendance ────────────────────────────────────────────
  if (normalized.includes("select * from attendance")) {
    return inMemoryResult([...memory.attendance].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into attendance")) {
    const [student_id, attendance_date, status, note] = params;
    const row = { id: memory.seq++, student_id, attendance_date, status, note: note || null, created_at: new Date().toISOString() };
    memory.attendance.push(row);
    return inMemoryResult([row]);
  }

  // ── Billing ───────────────────────────────────────────────
  if (normalized.includes("select * from billing")) {
    return inMemoryResult([...memory.billing].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into billing")) {
    const [student_id, month, amount] = params;
    const row = { id: memory.seq++, student_id, month, amount, paid_amount: 0, status: "unpaid", paid_at: null, created_at: new Date().toISOString() };
    memory.billing.push(row);
    return inMemoryResult([row]);
  }
  if (normalized.startsWith("update billing set") && normalized.includes("where id")) {
    const [paid_amount, status, paid_at, id] = params;
    const idx = memory.billing.findIndex((b) => Number(b.id) === Number(id));
    if (idx === -1) return inMemoryResult([]);
    memory.billing[idx] = { ...memory.billing[idx], paid_amount, status, paid_at: paid_at || null };
    return inMemoryResult([memory.billing[idx]]);
  }
  if (normalized.includes("select * from billing where id")) {
    const [id] = params;
    return inMemoryResult(memory.billing.filter((b) => Number(b.id) === Number(id)));
  }

  // ── Tahfidz ───────────────────────────────────────────────
  if (normalized.includes("select * from tahfidz_records")) {
    return inMemoryResult([...memory.tahfidz].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into tahfidz_records")) {
    const [student_id, record_date, type, surah_from, ayat_from, surah_to, ayat_to, juz, quality, note] = params;
    const row = { id: memory.seq++, student_id, record_date, type, surah_from, ayat_from, surah_to, ayat_to, juz: juz || null, quality: quality || "baik", note: note || null, created_at: new Date().toISOString() };
    memory.tahfidz.push(row);
    return inMemoryResult([row]);
  }

  // ── Dormitory Rooms ───────────────────────────────────────
  if (normalized.includes("select * from dormitory_rooms")) {
    return inMemoryResult([...memory.dormitory_rooms].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into dormitory_rooms")) {
    const [room_code, building, floor, capacity, gender] = params;
    if (memory.dormitory_rooms.some((r) => r.room_code === room_code)) throw new Error("duplicate room_code");
    const row = { id: memory.seq++, room_code, building, floor, capacity, gender, is_active: true, created_at: new Date().toISOString() };
    memory.dormitory_rooms.push(row);
    return inMemoryResult([row]);
  }

  // ── Dormitory Assignments ─────────────────────────────────
  if (normalized.includes("select * from dormitory_assignments")) {
    return inMemoryResult([...memory.dormitory_assignments].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into dormitory_assignments")) {
    const [student_id, room_id, assigned_at, note] = params;
    const row = { id: memory.seq++, student_id, room_id, assigned_at, vacated_at: null, note: note || null, created_at: new Date().toISOString() };
    memory.dormitory_assignments.push(row);
    return inMemoryResult([row]);
  }

  // ── Permits (Izin) ────────────────────────────────────────
  if (normalized.includes("select * from student_permits")) {
    return inMemoryResult([...memory.permits].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into student_permits")) {
    const [student_id, permit_type, reason, start_date, end_date] = params;
    const row = { id: memory.seq++, student_id, permit_type, reason, start_date, end_date, status: "pending", approved_by: null, approved_at: null, returned_at: null, note: null, created_at: new Date().toISOString() };
    memory.permits.push(row);
    return inMemoryResult([row]);
  }
  if (normalized.startsWith("update student_permits set status")) {
    const [status, approved_by, approved_at, id] = params;
    const idx = memory.permits.findIndex((p) => Number(p.id) === Number(id));
    if (idx === -1) return inMemoryResult([]);
    memory.permits[idx] = { ...memory.permits[idx], status, approved_by: approved_by || null, approved_at: approved_at || null };
    return inMemoryResult([memory.permits[idx]]);
  }

  // ── Staff / HR ────────────────────────────────────────────
  if (normalized.includes("select * from staff")) {
    return inMemoryResult([...memory.staff].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into staff")) {
    const [nip, full_name, role, subject, phone, address, join_date] = params;
    const row = { id: memory.seq++, nip: nip || null, full_name, role, subject: subject || null, phone: phone || null, address: address || null, join_date: join_date || null, status: "aktif", salary: 0, created_at: new Date().toISOString() };
    memory.staff.push(row);
    return inMemoryResult([row]);
  }
  if (normalized.startsWith("update staff set")) {
    const [salary, id] = params;
    const idx = memory.staff.findIndex((s) => Number(s.id) === Number(id));
    if (idx === -1) return inMemoryResult([]);
    memory.staff[idx] = { ...memory.staff[idx], salary };
    return inMemoryResult([memory.staff[idx]]);
  }

  // ── Staff Attendance ─────────────────────────────────────
  if (normalized.includes("select * from staff_attendance")) {
    return inMemoryResult([...memory.staff_attendance].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into staff_attendance")) {
    const [staff_id, attendance_date, status, note] = params;
    const row = { id: memory.seq++, staff_id, attendance_date, status, note: note || null, created_at: new Date().toISOString() };
    memory.staff_attendance.push(row);
    return inMemoryResult([row]);
  }

  // ── Student Violations ───────────────────────────────────
  if (normalized.includes("select * from student_violations")) {
    return inMemoryResult([...memory.student_violations].sort((a, b) => b.id - a.id));
  }
  if (normalized.startsWith("insert into student_violations")) {
    const [student_id, violation_type, severity, occurred_at, note] = params;
    const row = {
      id: memory.seq++,
      student_id,
      violation_type,
      severity: severity || "ringan",
      occurred_at: occurred_at || new Date().toISOString().slice(0, 10),
      note: note || null,
      created_at: new Date().toISOString()
    };
    memory.student_violations.push(row);
    return inMemoryResult([row]);
  }

  return inMemoryResult([]);
}

export async function initDb() {
  if (!pool) {
    memory.enabled = true;
    return;
  }

  try {
    // Tenants
    await query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        address TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await query(`
      INSERT INTO tenants (code, name) VALUES ('asy-syifaa','Pesantren Asy-Syifaa')
      ON CONFLICT (code) DO NOTHING;
    `);

    // Students
    await query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        nis VARCHAR(50) NOT NULL,
        full_name VARCHAR(150) NOT NULL,
        class_name VARCHAR(50) NOT NULL,
        guardian_name VARCHAR(150),
        gender CHAR(1) CHECK (gender IN ('L','P')),
        birth_date DATE,
        address TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','alumni','keluar')),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, nis)
      );
    `);

    // PPDB Registrations
    await query(`
      CREATE TABLE IF NOT EXISTS ppdb_registrations (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_name VARCHAR(150) NOT NULL,
        origin_school VARCHAR(150) NOT NULL,
        guardian_name VARCHAR(150),
        guardian_phone VARCHAR(30) NOT NULL,
        notes TEXT,
        source_page VARCHAR(50) NOT NULL DEFAULT '/ppdb',
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
        verified_by VARCHAR(100),
        verified_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // PPDB Settings
    await query(`
      CREATE TABLE IF NOT EXISTS ppdb_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        payload JSONB NOT NULL,
        updated_by VARCHAR(100),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Attendance
    await query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        attendance_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('hadir','izin','sakit','alpa')),
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Billing
    await query(`
      CREATE TABLE IF NOT EXISTS billing (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        month VARCHAR(7) NOT NULL,
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
        paid_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, student_id, month)
      );
    `);

    // Tahfidz
    await query(`
      CREATE TABLE IF NOT EXISTS tahfidz_records (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        record_date DATE NOT NULL DEFAULT CURRENT_DATE,
        type VARCHAR(20) NOT NULL CHECK (type IN ('ziyadah','murojaah')),
        surah_from VARCHAR(50) NOT NULL,
        ayat_from INT NOT NULL CHECK (ayat_from > 0),
        surah_to VARCHAR(50) NOT NULL,
        ayat_to INT NOT NULL CHECK (ayat_to > 0),
        juz INT CHECK (juz BETWEEN 1 AND 30),
        quality VARCHAR(20) DEFAULT 'baik' CHECK (quality IN ('mumtaz','jayyid_jiddan','jayyid','maqbul','dhoif')),
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Dormitory Rooms
    await query(`
      CREATE TABLE IF NOT EXISTS dormitory_rooms (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        room_code VARCHAR(20) UNIQUE NOT NULL,
        building VARCHAR(50) NOT NULL,
        floor INT NOT NULL DEFAULT 1,
        capacity INT NOT NULL DEFAULT 10 CHECK (capacity > 0),
        gender CHAR(1) NOT NULL CHECK (gender IN ('L','P')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Dormitory Assignments
    await query(`
      CREATE TABLE IF NOT EXISTS dormitory_assignments (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        room_id INT NOT NULL REFERENCES dormitory_rooms(id) ON DELETE RESTRICT,
        assigned_at DATE NOT NULL DEFAULT CURRENT_DATE,
        vacated_at DATE,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Permits
    await query(`
      CREATE TABLE IF NOT EXISTS student_permits (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        permit_type VARCHAR(30) NOT NULL CHECK (permit_type IN ('pulang','pesiar','sakit','keperluan')),
        reason TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','returned')),
        approved_by VARCHAR(100),
        approved_at TIMESTAMP,
        returned_at TIMESTAMP,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Staff
    await query(`
      CREATE TABLE IF NOT EXISTS staff (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        nip VARCHAR(50),
        full_name VARCHAR(150) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('ustadz','ustadzah','admin','bendahara','kepala_sekolah','staff_umum')),
        subject VARCHAR(100),
        phone VARCHAR(20),
        address TEXT,
        join_date DATE,
        status VARCHAR(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','cuti','nonaktif')),
        salary NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Staff Attendance (Modul SDM)
    await query(`
      CREATE TABLE IF NOT EXISTS staff_attendance (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        staff_id INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        attendance_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('hadir','izin','sakit','alpa')),
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Student Violations (Modul Kedisiplinan)
    await query(`
      CREATE TABLE IF NOT EXISTS student_violations (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        violation_type VARCHAR(120) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'ringan' CHECK (severity IN ('ringan','sedang','berat')),
        occurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

  } catch (_error) {
    memory.enabled = true;
  }
}

export function usingMemoryDb() {
  return memory.enabled;
}
