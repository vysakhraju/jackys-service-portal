// Mobile calendar view (2026-09-16), added ALONGSIDE the day-grouped list Dashboard
// (index.tsx) per your explicit choice - "Add calendar view alongside list" - not a
// replacement. Welcome header (name + role, mirroring index.tsx's own header pattern)
// followed by a month grid with day numbers, each day showing a count badge sourced from
// one GET /technician/schedule/month call per visible month (getMyMonthSchedule) rather
// than one call per day cell. Tapping a day reuses the exact same day/[date] route the
// list Dashboard's own section headers already navigate to - no new screen needed there.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { getMyMonthSchedule } from '../lib/technicianApi';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toMonthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function monthLabel(year: number, month: number): string {
  return new Date(`${toMonthKey(year, month)}-01T00:00:00`).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });
}

// Leading blanks so day 1 lands under its real weekday column; no trailing blanks - the
// grid just ends where the month does.
function buildGridCells(year: number, month: number): (number | null)[] {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(day);
  }
  return cells;
}

export default function CalendarScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12

  const monthKey = toMonthKey(year, month);
  const { data, isLoading, error } = useQuery({
    queryKey: ['technician-month-schedule', monthKey],
    queryFn: () => getMyMonthSchedule(monthKey),
  });

  const countsByDate = useMemo(() => {
    const map = new Map<string, number>();
    (data ?? []).forEach((entry) => map.set(entry.date, entry.count));
    return map;
  }, [data]);

  const cells = useMemo(() => buildGridCells(year, month), [year, month]);
  const todayIso = toIsoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

  function goToPrevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function openDay(date: string) {
    router.push({ pathname: '/day/[date]', params: { date } });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{user ? `Welcome, ${user.firstName}` : 'Welcome'}</Text>
          {user && (
            <Text style={styles.headerSubtitle}>
              {user.firstName} {user.lastName}
              {user.role?.displayName ? ` · ${user.role.displayName}` : ''}
            </Text>
          )}
        </View>
        <Pressable onPress={() => logout()} testID="logout-button">
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>

      <Pressable style={styles.altViewLink} onPress={() => router.push('/')} testID="open-list-view">
        <Text style={styles.altViewLinkText}>View list ›</Text>
      </Pressable>

      <View style={styles.monthNav}>
        <Pressable onPress={goToPrevMonth} testID="calendar-prev-month" hitSlop={8}>
          <Text style={styles.monthNavArrow}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel} testID="calendar-month-label">
          {monthLabel(year, month)}
        </Text>
        <Pressable onPress={goToNextMonth} testID="calendar-next-month" hitSlop={8}>
          <Text style={styles.monthNavArrow}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <Text key={`weekday-${i}`} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isLoading && <Text style={styles.emptyText}>Loading…</Text>}

        {error && !isLoading && (
          <Text style={styles.errorText} testID="calendar-error">
            Couldn&apos;t load this month. Try again.
          </Text>
        )}

        {!isLoading && !error && (
          <View style={styles.grid}>
            {cells.map((day, index) => {
              if (day === null) {
                return <View key={`blank-${index}`} style={styles.dayCell} />;
              }
              const iso = toIsoDate(year, month, day);
              const count = countsByDate.get(iso) ?? 0;
              const isToday = iso === todayIso;
              return (
                <Pressable
                  key={iso}
                  style={[styles.dayCell, isToday && styles.dayCellToday]}
                  onPress={() => openDay(iso)}
                  testID={`calendar-day-${iso}`}
                >
                  <Text style={[styles.dayNumber, isToday && styles.dayNumberToday]}>{day}</Text>
                  {count > 0 && (
                    <View style={styles.countBadge} testID={`calendar-day-count-${iso}`}>
                      <Text style={styles.countBadgeText}>{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const CELL_WIDTH = '14.2857%';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  headerSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  logoutText: { fontSize: 13, color: '#2563eb', fontWeight: '500', paddingTop: 4 },
  altViewLink: { paddingHorizontal: 20, paddingBottom: 8 },
  altViewLinkText: { fontSize: 13, color: '#2563eb', fontWeight: '500' },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  monthNavArrow: { fontSize: 22, color: '#334155', paddingHorizontal: 8 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: 16 },
  weekdayLabel: {
    width: CELL_WIDTH,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24 },
  emptyText: { color: '#94a3b8', fontSize: 13, paddingTop: 12, paddingHorizontal: 4 },
  errorText: { color: '#b91c1c', fontSize: 13, paddingTop: 12, paddingHorizontal: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: CELL_WIDTH,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  dayCellToday: { backgroundColor: '#dbeafe', borderRadius: 999 },
  dayNumber: { fontSize: 14, color: '#0f172a' },
  dayNumberToday: { color: '#1d4ed8', fontWeight: '700' },
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { fontSize: 10, fontWeight: '700', color: '#ffffff' },
});
