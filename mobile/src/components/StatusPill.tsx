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
  // WarrantyStatus (Phase 3) - same green/amber convention the web app's StatusBadge
  // uses for IW/OOW.
  IW: { bg: '#dcfce7', fg: '#166534' },
  OOW: { bg: '#fef9c3', fg: '#854d0e' },
  // Job Card lane badge (mirrors the web app's JobCardsPage LANE_META) - prefixed
  // LANE_ so these synthetic keys can never collide with a real backend status/enum
  // value passed to this same lookup.
  LANE_A: { bg: '#dcfce7', fg: '#166534' },
  LANE_B: { bg: '#fef9c3', fg: '#854d0e' },
  LANE_C: { bg: '#e0f2fe', fg: '#0369a1' },
  LANE_D: { bg: '#ede9fe', fg: '#6d28d9' },
};

// `label` overrides the auto-generated "STATUS_LIKE_THIS" text (e.g. "In Warranty"
// instead of "IW") while `status` still drives the color lookup and the testID, so a
// screen can show friendlier copy without inventing a second status->color mapping.
export function StatusPill({ status, label }: { status: string; label?: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.SCHEDULED;
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg }]} testID={`status-pill-${status}`}>
      <Text style={[styles.pillText, { color: colors.fg }]}>{label ?? status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '600' },
});
