function toIsoDay(value) {
  if (!value) return "";
  const text = String(value);
  return text.slice(0, 10);
}

function toMonthKey(value) {
  if (!value) return "";
  const text = String(value);
  return text.slice(0, 7);
}

function normalizeLevel(className) {
  const text = String(className || "").trim().toUpperCase();
  if (!text) return "Tidak Diketahui";
  if (text.includes("MI")) return "MI";
  if (text.includes("MTS")) return "MTS";
  if (text.includes("MA")) return "MA";

  const match = text.match(/\d+/);
  if (match) {
    const grade = Number(match[0]);
    if (grade >= 1 && grade <= 6) return "MI";
    if (grade >= 7 && grade <= 9) return "MTs";
    if (grade >= 10 && grade <= 12) return "MA";
  }

  return "Lainnya";
}

export function getVisibleWidgetsByRole(role) {
  const cleanRole = String(role || "").toLowerCase();
  const map = {
    superadmin: [
      "demografi_santri",
      "ppdb_trend",
      "finance_cashflow",
      "dormitory_occupancy",
      "permits_live",
      "violations_top5",
      "tahfidz_weekly",
      "sdm_attendance"
    ],
    mudir_aam: [
      "demografi_santri",
      "ppdb_trend",
      "finance_cashflow",
      "dormitory_occupancy",
      "permits_live",
      "violations_top5",
      "tahfidz_weekly",
      "sdm_attendance"
    ],
    pengasuh: [
      "demografi_santri",
      "ppdb_trend",
      "finance_cashflow",
      "tahfidz_weekly",
      "sdm_attendance"
    ],
    bendahara: ["finance_cashflow"],
    admin_keuangan: ["finance_cashflow"],
    kepala_sekolah: ["demografi_santri", "ppdb_trend", "violations_top5", "tahfidz_weekly", "sdm_attendance"],
    staff_umum: ["demografi_santri", "ppdb_trend", "dormitory_occupancy", "permits_live"],
    admin_kesantrian: ["demografi_santri", "ppdb_trend", "dormitory_occupancy", "permits_live", "violations_top5"],
    ustadz: ["demografi_santri", "permits_live", "violations_top5", "tahfidz_weekly"],
    ustadzah: ["demografi_santri", "permits_live", "violations_top5", "tahfidz_weekly"],
    wali: ["demografi_santri"],
    umum: []
  };
  return map[cleanRole] || map.umum;
}

export function aggregateActiveStudentsByLevel(students = []) {
  const active = students.filter((row) => String(row.status || "").toLowerCase() === "aktif");
  const byLevelMap = new Map();

  for (const row of active) {
    const level = normalizeLevel(row.class_name);
    byLevelMap.set(level, (byLevelMap.get(level) || 0) + 1);
  }

  const byLevel = [...byLevelMap.entries()]
    .map(([level, total]) => ({ level, total }))
    .sort((a, b) => b.total - a.total);

  return {
    total_active: active.length,
    by_level: byLevel
  };
}

export function aggregatePpdbDailyTrend(ppdbRows = [], options = {}) {
  const now = options.now || new Date();
  const days = Number(options.days || 14);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const bucket = new Map();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    bucket.set(key, 0);
  }

  for (const row of ppdbRows) {
    const key = toIsoDay(row.created_at);
    if (!bucket.has(key)) continue;
    bucket.set(key, (bucket.get(key) || 0) + 1);
  }

  const daily = [...bucket.entries()].map(([date, total]) => ({ date, total }));
  const todayKey = end.toISOString().slice(0, 10);
  return {
    days,
    daily,
    today_total: bucket.get(todayKey) || 0
  };
}

export function aggregateFinanceCurrentMonth(billingRows = [], options = {}) {
  const now = options.now || new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const monthRows = billingRows.filter((row) => toMonthKey(row.month) === currentMonth);

  let totalReceipts = 0;
  for (const row of monthRows) {
    const paidAmount = Number(row.paid_amount || 0);
    if (paidAmount > 0) {
      totalReceipts += paidAmount;
      continue;
    }
    if (String(row.status).toLowerCase() === "paid") {
      totalReceipts += Number(row.amount || 0);
    }
  }

  const paidCount = monthRows.filter((row) => String(row.status || "").toLowerCase() === "paid").length;
  const arrearsCount = monthRows.length - paidCount;
  const denominator = monthRows.length || 1;

  return {
    month: currentMonth,
    total_receipts: totalReceipts,
    total_bills: monthRows.length,
    paid_count: paidCount,
    arrears_count: arrearsCount,
    paid_percentage: Number(((paidCount / denominator) * 100).toFixed(2)),
    arrears_percentage: Number(((arrearsCount / denominator) * 100).toFixed(2))
  };
}

export function aggregateDormitoryOccupancy(rooms = [], assignments = []) {
  const activeRooms = rooms.filter((row) => row.is_active !== false);
  const capacityTotal = activeRooms.reduce((sum, row) => sum + Number(row.capacity || 0), 0);
  const activeAssignments = assignments.filter((row) => !row.vacated_at);
  const occupiedTotal = activeAssignments.length;
  const availableTotal = Math.max(capacityTotal - occupiedTotal, 0);
  const occupancyRate = capacityTotal > 0 ? Number(((occupiedTotal / capacityTotal) * 100).toFixed(2)) : 0;

  return {
    capacity_total: capacityTotal,
    occupied_total: occupiedTotal,
    available_total: availableTotal,
    occupancy_rate: occupancyRate
  };
}

export function aggregateLivePermits(permits = [], options = {}) {
  const now = options.now || new Date();
  const today = now.toISOString().slice(0, 10);
  const activeStatuses = new Set(["pending", "approved"]);

  const live = permits
    .filter((row) => {
      const status = String(row.status || "").toLowerCase();
      if (!activeStatuses.has(status)) return false;
      const start = toIsoDay(row.start_date);
      const end = toIsoDay(row.end_date);
      if (!start || !end) return true;
      return start <= today && end >= today;
    })
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      student_id: row.student_id,
      permit_type: row.permit_type,
      status: row.status,
      start_date: row.start_date,
      end_date: row.end_date
    }));

  return {
    total_live: live.length,
    items: live
  };
}

export function aggregateTopViolations(violations = [], options = {}) {
  const now = options.now || new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const map = new Map();

  for (const row of violations) {
    const month = toMonthKey(row.occurred_at || row.created_at);
    if (month !== currentMonth) continue;
    const key = String(row.violation_type || "Lainnya").trim() || "Lainnya";
    map.set(key, (map.get(key) || 0) + 1);
  }

  const items = [...map.entries()]
    .map(([violation_type, total]) => ({ violation_type, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    month: currentMonth,
    items
  };
}

export function aggregateTahfidzWeeklyZiyadah(records = [], options = {}) {
  const now = options.now || new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const startKey = start.toISOString().slice(0, 10);
  const endKey = end.toISOString().slice(0, 10);

  const weekly = records.filter((row) => {
    const date = toIsoDay(row.record_date || row.created_at);
    const type = String(row.type || "").toLowerCase();
    return type === "ziyadah" && date >= startKey && date <= endKey;
  });

  return {
    week_range: { start: startKey, end: endKey },
    total_ziyadah: weekly.length
  };
}

export function aggregateSdmAttendanceToday(staffRows = [], attendanceRows = [], options = {}) {
  const now = options.now || new Date();
  const today = now.toISOString().slice(0, 10);
  const counter = { hadir: 0, izin: 0, sakit: 0, alpa: 0 };

  const todayAttendance = attendanceRows.filter((row) => toIsoDay(row.attendance_date) === today);
  if (todayAttendance.length > 0) {
    for (const row of todayAttendance) {
      const status = String(row.status || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(counter, status)) {
        counter[status] += 1;
      }
    }
    return {
      date: today,
      total_staff: staffRows.length,
      total_logged: todayAttendance.length,
      ...counter
    };
  }

  // Fallback jika presensi SDM belum dicatat: estimasi dari status staff.
  for (const row of staffRows) {
    const status = String(row.status || "").toLowerCase();
    if (status === "aktif") counter.hadir += 1;
    else if (status === "cuti") counter.izin += 1;
    else counter.alpa += 1;
  }

  return {
    date: today,
    total_staff: staffRows.length,
    total_logged: 0,
    ...counter
  };
}

export function buildCommandCenterPayload(input, options = {}) {
  const now = options.now || new Date();
  return {
    generated_at: now.toISOString(),
    demografi_santri: aggregateActiveStudentsByLevel(input.students),
    ppdb_trend: aggregatePpdbDailyTrend(input.ppdb, { now, days: 14 }),
    finance_cashflow: aggregateFinanceCurrentMonth(input.billing, { now }),
    dormitory_occupancy: aggregateDormitoryOccupancy(input.rooms, input.assignments),
    permits_live: aggregateLivePermits(input.permits, { now }),
    violations_top5: aggregateTopViolations(input.violations, { now }),
    tahfidz_weekly: aggregateTahfidzWeeklyZiyadah(input.tahfidz, { now }),
    sdm_attendance: aggregateSdmAttendanceToday(input.staff, input.staffAttendance, { now })
  };
}

export function filterWidgetsByAccess(payload, visibleWidgetKeys = []) {
  const set = new Set(visibleWidgetKeys);
  const widgets = {};
  for (const key of visibleWidgetKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      widgets[key] = payload[key];
    }
  }
  return {
    generated_at: payload.generated_at,
    widgets,
    visible_widgets: [...set]
  };
}
