// Shared appointment-status pill - originally inline in the schedule screen, extracted
// here in Phase 2 now that the appointment detail screen needs the same look.
import { StyleSheet, Text, View } from 'react-native';

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  SCHEDULED: { bg: '#e2e8f0', fg: '#334155' },
  CONFIRMED: { bg: '#dbeafe', fg: '#1d4ed8' },
  TECHNICIAN_ASSIGNED: { bg: '#e0e7ff', fg: '#4338ca' },
  ON_SITE: { bg: '#fef9c3', fg: '#854d0e' },
  COMPLETED: { bg: '#dcfce7', fg: '#166534' },
  CANCELLED: { bg: '#fee2e2', fg: '#991b1b' },
  NO_SHOW: { bg: '#fee2e2', fg: '#991b1b' },
  RESCHEDULED: { bg: '#f3e8ff', fg: '#6b21a8' },
};

export function StatusPill({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.SCHEDULED;
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg }]} testID={`status-pill-${status}`}>
      <Text style={[styles.pillText, { color: colors.fg }]}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '600' },
});
