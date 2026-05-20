import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateActiveStudentsByLevel,
  aggregatePpdbDailyTrend,
  aggregateFinanceCurrentMonth,
  aggregateDormitoryOccupancy,
  aggregateTahfidzWeeklyZiyadah,
  aggregateSdmAttendanceToday,
  getVisibleWidgetsByRole
} from "./dashboard-aggregations.js";

test("aggregateActiveStudentsByLevel menghitung santri aktif per level", () => {
  const result = aggregateActiveStudentsByLevel([
    { class_name: "7A", status: "aktif" },
    { class_name: "8B", status: "aktif" },
    { class_name: "11 IPA", status: "aktif" },
    { class_name: "5", status: "alumni" }
  ]);

  assert.equal(result.total_active, 3);
  assert.deepEqual(result.by_level, [
    { level: "MTs", total: 2 },
    { level: "MA", total: 1 }
  ]);
});

test("aggregatePpdbDailyTrend membuat bucket 14 hari", () => {
  const now = new Date("2026-05-18T10:00:00.000Z");
  const result = aggregatePpdbDailyTrend(
    [
      { created_at: "2026-05-18T01:00:00.000Z" },
      { created_at: "2026-05-18T02:00:00.000Z" },
      { created_at: "2026-05-17T08:00:00.000Z" }
    ],
    { now, days: 3 }
  );

  assert.equal(result.daily.length, 3);
  assert.equal(result.today_total, 2);
  assert.deepEqual(result.daily, [
    { date: "2026-05-16", total: 0 },
    { date: "2026-05-17", total: 1 },
    { date: "2026-05-18", total: 2 }
  ]);
});

test("aggregateFinanceCurrentMonth menghitung penerimaan dan persentase", () => {
  const now = new Date("2026-05-18T10:00:00.000Z");
  const result = aggregateFinanceCurrentMonth(
    [
      { month: "2026-05", amount: 500000, paid_amount: 500000, status: "paid" },
      { month: "2026-05", amount: 400000, paid_amount: 0, status: "unpaid" },
      { month: "2026-04", amount: 350000, paid_amount: 350000, status: "paid" }
    ],
    { now }
  );

  assert.equal(result.total_bills, 2);
  assert.equal(result.total_receipts, 500000);
  assert.equal(result.paid_count, 1);
  assert.equal(result.arrears_count, 1);
  assert.equal(result.paid_percentage, 50);
  assert.equal(result.arrears_percentage, 50);
});

test("aggregateDormitoryOccupancy menghitung kapasitas dan okupansi", () => {
  const result = aggregateDormitoryOccupancy(
    [
      { id: 1, capacity: 20, is_active: true },
      { id: 2, capacity: 10, is_active: true },
      { id: 3, capacity: 8, is_active: false }
    ],
    [
      { id: 1, room_id: 1, vacated_at: null },
      { id: 2, room_id: 1, vacated_at: null },
      { id: 3, room_id: 2, vacated_at: "2026-05-01" }
    ]
  );

  assert.equal(result.capacity_total, 30);
  assert.equal(result.occupied_total, 2);
  assert.equal(result.available_total, 28);
  assert.equal(result.occupancy_rate, 6.67);
});

test("aggregateTahfidzWeeklyZiyadah menghitung ziyadah minggu berjalan", () => {
  const now = new Date("2026-05-18T10:00:00.000Z");
  const result = aggregateTahfidzWeeklyZiyadah(
    [
      { type: "ziyadah", record_date: "2026-05-18" },
      { type: "ziyadah", record_date: "2026-05-16" },
      { type: "murojaah", record_date: "2026-05-17" },
      { type: "ziyadah", record_date: "2026-05-01" }
    ],
    { now }
  );

  assert.equal(result.total_ziyadah, 2);
});

test("aggregateSdmAttendanceToday fallback ke status staff jika data harian kosong", () => {
  const now = new Date("2026-05-18T10:00:00.000Z");
  const result = aggregateSdmAttendanceToday(
    [
      { status: "aktif" },
      { status: "aktif" },
      { status: "cuti" },
      { status: "nonaktif" }
    ],
    [],
    { now }
  );

  assert.equal(result.hadir, 2);
  assert.equal(result.izin, 1);
  assert.equal(result.alpa, 1);
  assert.equal(result.total_staff, 4);
});

test("getVisibleWidgetsByRole untuk bendahara hanya finance", () => {
  const keys = getVisibleWidgetsByRole("bendahara");
  assert.deepEqual(keys, ["finance_cashflow"]);
});

test("getVisibleWidgetsByRole admin_keuangan tidak bocor ke widget asrama", () => {
  const keys = getVisibleWidgetsByRole("admin_keuangan");
  assert.ok(keys.includes("finance_cashflow"));
  assert.equal(keys.includes("dormitory_occupancy"), false);
  assert.equal(keys.includes("permits_live"), false);
});

test("getVisibleWidgetsByRole admin_kesantrian tidak bocor ke widget finance", () => {
  const keys = getVisibleWidgetsByRole("admin_kesantrian");
  assert.ok(keys.includes("dormitory_occupancy"));
  assert.ok(keys.includes("permits_live"));
  assert.ok(keys.includes("violations_top5"));
  assert.equal(keys.includes("finance_cashflow"), false);
});
