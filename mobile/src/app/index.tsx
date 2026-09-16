// Mobile Phase 3: the Dashboard - "schedules grouped by day... tapping a date opens that
// day's appointments, same as today's day view but with the coloring." This is a
// genuinely new screen (the old single-day content this file used to hold now lives at
// day/[date].tsx, reachable by tapping a section header below); it fetches a bounded
// 4-day window (yesterday/today/tomorrow/day+2) via 4 parallel calls to the SAME
// getMySchedule(date) the day screen already uses - zero backend changes, and each
// section's cache is already warm by the time a technician taps into that day.
//
// "Overdue" is yesterday's appointments still on this list at all - the schedule
// endpoint (getTechnicianSchedule) already filters to only-still-active statuses
// (SCHEDULED/CONFIRMED/TECHNICIAN_ASSIGNED/ON_SITE), so anything that finished,
// cancelled, or moved to workshop yesterday never shows up here in the first place; no
// extra client-side filtering needed for "still pending" to be true.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { OfflineBanner } from '../components/OfflineBanner';
import { StatusPill } from '../components/StatusPill';
import { formatElapsedLabel, urgencyLevel, URGENCY_COLORS } from '../lib/appointmentUrgency';
import { getMySchedule } from '../lib/technicianApi';
import type { ScheduledAppointment } from '../lib/types';

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toIsoDate(d);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Section headers, not the day-screen's own date label (formatDateLabel in
// day/[date].tsx) - "Overdue" has no equivalent there since that screen never shows
// yesterday by itself as a concept, only as a date you can navigate back to.
function sectionLabel(offset: number, iso: string): string {
  if (offset === -1) return 'Overdue';
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return new Date(`${iso}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function AppointmentCard({ appointment, onPress }: { appointment: ScheduledAppointment; onPress: () => void }) {
  const urgency = urgencyLevel(appointment.scheduledAt);
  const urgencyColors = URGENCY_COLORS[urgency];
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`appointment-${appointment.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.time}>{formatTime(appointment.scheduledAt)}</Text>
        <View style={styles.pillRow}>
          <View
            style={[styles.urgencyPill, { backgroundColor: urgencyColors.bg }]}
            testID={`urgency-${appointment.id}-${urgency}`}
          >
            <Text style={[styles.urgencyPillText, { color: urgencyColors.fg }]}>{formatElapsedLabel(appointment.scheduledAt)}</Text>
          </View>
          <StatusPill status={appointment.status} />
        </View>
      </View>
      <Text style={styles.customerName}>{appointment.customerName}</Text>
      {appointment.customerAddress && <Text style={styles.meta}>{appointment.customerAddress}</Text>}
      {(appointment.brand || appointment.modelNumber) && (
        <Text style={styles.meta}>
          {[appointment.brand, appointment.modelNumber].filter(Boolean).join(' · ')}
        </Text>
      )}
      {appointment.problemDescription && (
        <Text style={styles.problem} numberOfLines={2}>
          {appointment.problemDescription}
        </Text>
      )}
    </Pressable>
  );
}

// One day's section of the dashboard - its own query (sharing the exact ['technician-
// schedule', date] key the day screen uses, so navigating into a day the dashboard
// already fetched shows cached data instantly), its own loading/error/empty states, and
// a header that navigates to the full day/[date] view.
function DaySection({
  offset,
  date,
  hideWhenEmpty,
  onOpenDay,
  onOpenAppointment,
}: {
  offset: number;
  date: string;
  hideWhenEmpty: boolean;
  onOpenDay: (date: string) => void;
  onOpenAppointment: (appointment: ScheduledAppointment) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['technician-schedule', date],
    queryFn: () => getMySchedule(date),
  });

  const sorted = (data ?? []).slice().sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  if (hideWhenEmpty && !isLoading && !error && sorted.length === 0) {
    return null;
  }

  return (
    <View style={styles.section} testID={`day-section-${date}`}>
      <Pressable style={styles.sectionHeader} onPress={() => onOpenDay(date)} testID={`day-section-header-${date}`}>
        <Text style={styles.sectionTitle}>{sectionLabel(offset, date)}</Text>
        <Text style={styles.sectionArrow}>›</Text>
      </Pressable>

      {isLoading && <Text style={styles.emptyText}>Loading…</Text>}

      {error && !isLoading && (
        <Text style={styles.errorText} testID={`day-section-error-${date}`}>
          Couldn&apos;t load this day. Tap to open and try again.
        </Text>
      )}

      {!isLoading && !error && sorted.length === 0 && (
        <Text style={styles.emptyText}>Nothing scheduled.</Text>
      )}

      {!isLoading &&
        !error &&
        sorted.map((item) => (
          <AppointmentCard key={item.id} appointment={item} onPress={() => onOpenAppointment(item)} />
        ))}
    </View>
  );
}

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [anchorDate] = useState(() => toIsoDate(new Date()));

  const dates = {
    yesterday: addDays(anchorDate, -1),
    today: anchorDate,
    tomorrow: addDays(anchorDate, 1),
    dayAfterTomorrow: addDays(anchorDate, 2),
  };

  function openDay(date: string) {
    router.push({ pathname: '/day/[date]', params: { date } });
  }

  function openAppointment(appointment: ScheduledAppointment) {
    router.push({ pathname: '/appointment/[id]', params: { id: appointment.id, appt: JSON.stringify(appointment) } });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Schedule</Text>
          {user && (
            <Text style={styles.headerSubtitle}>
              {user.firstName} {user.lastName}
            </Text>
          )}
        </View>
        <Pressable onPress={() => logout()} testID="logout-button">
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>

      <OfflineBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <DaySection offset={-1} date={dates.yesterday} hideWhenEmpty onOpenDay={openDay} onOpenAppointment={openAppointment} />
        <DaySection offset={0} date={dates.today} hideWhenEmpty={false} onOpenDay={openDay} onOpenAppointment={openAppointment} />
        <DaySection offset={1} date={dates.tomorrow} hideWhenEmpty={false} onOpenDay={openDay} onOpenAppointment={openAppointment} />
        <DaySection
          offset={2}
          date={dates.dayAfterTomorrow}
          hideWhenEmpty={false}
          onOpenDay={openDay}
          onOpenAppointment={openAppointment}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

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
  scrollContent: { padding: 16, gap: 20 },
  section: { gap: 10 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  sectionArrow: { fontSize: 18, color: '#94a3b8' },
  emptyText: { color: '#94a3b8', fontSize: 13 },
  errorText: { color: '#b91c1c', fontSize: 13 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  time: { fontSize: 14, fontWeight: '600', color: '#334155' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  urgencyPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  urgencyPillText: { fontSize: 11, fontWeight: '600' },
  customerName: { fontSize: 16, fontWeight: '600', color: '#0f172a', marginBottom: 2 },
  meta: { fontSize: 13, color: '#64748b', marginBottom: 2 },
  problem: { fontSize: 13, color: '#475569', marginTop: 4 },
});
