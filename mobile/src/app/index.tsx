import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { OfflineBanner } from '../components/OfflineBanner';
import { StatusPill } from '../components/StatusPill';
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

function formatDateLabel(iso: string): string {
  const today = toIsoDate(new Date());
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return new Date(`${iso}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function AppointmentCard({ appointment, onPress }: { appointment: ScheduledAppointment; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`appointment-${appointment.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.time}>{formatTime(appointment.scheduledAt)}</Text>
        <StatusPill status={appointment.status} />
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

export default function ScheduleScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(() => toIsoDate(new Date()));

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['technician-schedule', date],
    queryFn: () => getMySchedule(date),
  });

  const sorted = useMemo(
    () => (data ?? []).slice().sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [data],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Today&apos;s Schedule</Text>
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

      <View style={styles.dateNav}>
        <Pressable onPress={() => setDate((d) => addDays(d, -1))} style={styles.dateNavButton} testID="date-prev">
          <Text style={styles.dateNavArrow}>‹</Text>
        </Pressable>
        <Text style={styles.dateLabel} testID="date-label">
          {formatDateLabel(date)}
        </Text>
        <Pressable onPress={() => setDate((d) => addDays(d, 1))} style={styles.dateNavButton} testID="date-next">
          <Text style={styles.dateNavArrow}>›</Text>
        </Pressable>
      </View>

      {isLoading && (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>Loading…</Text>
        </View>
      )}

      {error && !isLoading && (
        <View style={styles.centerFill}>
          <Text style={styles.errorText} testID="schedule-error">
            Couldn&apos;t load your schedule. Pull down to try again.
          </Text>
        </View>
      )}

      {!isLoading && !error && sorted.length === 0 && (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>Nothing on your schedule for this date.</Text>
        </View>
      )}

      {!isLoading && !error && sorted.length > 0 && (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AppointmentCard
              appointment={item}
              onPress={() =>
                router.push({ pathname: '/appointment/[id]', params: { id: item.id, appt: JSON.stringify(item) } })
              }
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
        />
      )}
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
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  dateNavButton: { paddingHorizontal: 16, paddingVertical: 4 },
  dateNavArrow: { fontSize: 22, color: '#334155' },
  dateLabel: { fontSize: 15, fontWeight: '600', color: '#0f172a', minWidth: 130, textAlign: 'center' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { color: '#94a3b8', fontSize: 14, textAlign: 'center' },
  errorText: { color: '#b91c1c', fontSize: 14, textAlign: 'center' },
  listContent: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  time: { fontSize: 14, fontWeight: '600', color: '#334155' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '600' },
  customerName: { fontSize: 16, fontWeight: '600', color: '#0f172a', marginBottom: 2 },
  meta: { fontSize: 13, color: '#64748b', marginBottom: 2 },
  problem: { fontSize: 13, color: '#475569', marginTop: 4 },
});
