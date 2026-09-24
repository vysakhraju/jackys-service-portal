// Mobile "Completed Work" screen (2026-09-24 live finding, point 1): "once user click work
// finished lets created a page in mobile to see completed work or repairs for field
// technician to see". Backed by GET /technician/completed-work (getCompletedWork) - the
// technician's own finished Installation/Delivery Installation jobs (Activity Finished, on
// mobile or via a CCE override) plus completed Repairs, most recent first. Reached from the
// Dashboard's own link, same "altViewLink" pattern index.tsx already uses for Calendar view,
// and from the appointment detail screen's own Activity Finished confirmation.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OfflineBanner } from '../components/OfflineBanner';
import { StatusPill } from '../components/StatusPill';
import { getCompletedWork } from '../lib/technicianApi';
import type { CompletedWorkItem, JobTypeValue } from '../lib/types';

// Same label set as appointment/[id].tsx's own JOB_TYPE_LABELS - kept local rather than
// exported/shared, matching how this codebase already duplicates small mobile-only display
// maps per screen rather than introducing a shared-constants module for a 4-entry lookup.
const JOB_TYPE_LABELS: Record<JobTypeValue, string> = {
  REPAIR: 'Repair',
  INSTALLATION: 'Installation',
  DELIVERY_INSTALLATION: 'Delivery + Installation',
  MAINTENANCE: 'Maintenance',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// activityFinishedAt is the real "work finished" moment for an Installation/Delivery
// Installation job (set the instant the technician taps Activity Finished, well before
// Appointment.status itself catches up - see AppointmentsService's own doc comment on
// excludeFinishedActivityAppointments()). It's null for a Repair, which only ever reaches
// this list once Appointment.status is COMPLETED - updatedAt is the best available
// completion time there, same fallback the backend's own sort uses.
function completionLabel(item: CompletedWorkItem): { label: string; at: string } {
  if (item.activityFinishedAt) {
    return { label: 'Work finished', at: item.activityFinishedAt };
  }
  return { label: 'Completed', at: item.updatedAt };
}

function CompletedWorkCard({ item, onPress }: { item: CompletedWorkItem; onPress: () => void }) {
  const completion = completionLabel(item);
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`completed-work-${item.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.appointmentNumber}>{item.appointmentNumber}</Text>
        <StatusPill status={item.status} />
      </View>
      <Text style={styles.customerName}>{item.customerName}</Text>
      {(item.brand || item.modelNumber) && (
        <Text style={styles.meta}>{[item.brand, item.modelNumber].filter(Boolean).join(' · ')}</Text>
      )}
      {item.jobType && (
        <Text style={styles.meta}>Job Type: {JOB_TYPE_LABELS[item.jobType] ?? item.jobType}</Text>
      )}
      <View style={styles.completionRow} testID={`completed-work-${item.id}-completion`}>
        <Text style={styles.completionCheck}>✓</Text>
        <Text style={styles.completionText}>
          {completion.label} {formatDateTime(completion.at)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function CompletedWorkScreen() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['technician-completed-work'],
    queryFn: () => getCompletedWork(),
  });

  function openAppointment(item: CompletedWorkItem) {
    router.push({ pathname: '/appointment/[id]', params: { id: item.id, appt: JSON.stringify(item) } });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="back-button" hitSlop={12}>
          <Text style={styles.backText}>‹ Schedule</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Completed Work</Text>
      </View>

      <OfflineBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isLoading && <Text style={styles.emptyText}>Loading…</Text>}

        {error && !isLoading && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText} testID="completed-work-error">
              Couldn&apos;t load your completed work.
            </Text>
            <Pressable onPress={() => refetch()} testID="completed-work-retry" disabled={isRefetching}>
              <Text style={styles.retryText}>{isRefetching ? 'Retrying…' : 'Tap to retry'}</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && (data ?? []).length === 0 && (
          <Text style={styles.emptyText}>No completed work yet.</Text>
        )}

        {!isLoading &&
          !error &&
          (data ?? []).map((item) => (
            <CompletedWorkCard key={item.id} item={item} onPress={() => openAppointment(item)} />
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backText: { fontSize: 15, color: '#2563eb', fontWeight: '500' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  scrollContent: { padding: 16, gap: 12 },
  emptyText: { color: '#94a3b8', fontSize: 13, paddingHorizontal: 4 },
  errorBox: { gap: 6, paddingHorizontal: 4 },
  errorText: { color: '#b91c1c', fontSize: 13 },
  retryText: { color: '#2563eb', fontSize: 13, fontWeight: '500' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  appointmentNumber: { fontSize: 13, fontWeight: '600', color: '#334155' },
  customerName: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  meta: { fontSize: 13, color: '#64748b' },
  completionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  completionCheck: { fontSize: 13, color: '#16a34a', fontWeight: '700' },
  completionText: { fontSize: 13, color: '#16a34a', fontWeight: '500' },
});
