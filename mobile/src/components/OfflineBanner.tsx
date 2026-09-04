// Phase 4. Shown on any screen that mounts it (Today's Schedule for now) whenever the
// offline queue has anything worth the technician's attention - queued items sync
// silently in the background, so this stays collapsed to a one-line summary unless
// there's something failed that actually needs a decision.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOfflineQueue } from '../context/OfflineQueueContext';
import type { QueuedActionType } from '../lib/offlineQueue';

const ACTION_LABELS: Record<QueuedActionType, string> = {
  START_VISIT: 'Start visit',
  CAPTURE_SERIAL_NUMBER: 'Serial number capture',
  CAPTURE_FAULT_SYMPTOM: 'Fault/symptom capture',
};

export function OfflineBanner() {
  const { isOnline, pendingItems, failedItems, retry, dismiss } = useOfflineQueue();
  const [expanded, setExpanded] = useState(false);

  if (pendingItems.length === 0 && failedItems.length === 0) {
    return null;
  }

  const hasFailures = failedItems.length > 0;
  const summary = hasFailures
    ? `${failedItems.length} ${failedItems.length === 1 ? 'item needs' : 'items need'} attention`
    : isOnline
      ? `Syncing ${pendingItems.length} ${pendingItems.length === 1 ? 'item' : 'items'}…`
      : `${pendingItems.length} queued - will sync when back online`;

  return (
    <View style={[styles.container, hasFailures && styles.containerAlert]} testID="offline-banner">
      <Pressable style={styles.summaryRow} onPress={() => setExpanded((e) => !e)} testID="offline-banner-toggle">
        {!hasFailures && isOnline && pendingItems.length > 0 && (
          <ActivityIndicator size="small" color="#854d0e" style={styles.spinner} />
        )}
        <Text style={[styles.summaryText, hasFailures && styles.summaryTextAlert]}>{summary}</Text>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.list}>
          {failedItems.map((item) => (
            <View key={item.id} style={styles.failedRow} testID={`offline-item-failed-${item.id}`}>
              <Text style={styles.itemLabel}>
                {ACTION_LABELS[item.type]} · {item.label}
              </Text>
              {item.errorMessage && <Text style={styles.itemError}>{item.errorMessage}</Text>}
              <View style={styles.itemActions}>
                <Pressable onPress={() => retry(item.id)} testID={`offline-item-retry-${item.id}`} hitSlop={8}>
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
                <Pressable onPress={() => dismiss(item.id)} testID={`offline-item-dismiss-${item.id}`} hitSlop={8}>
                  <Text style={styles.dismissText}>Discard</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {pendingItems.map((item) => (
            <View key={item.id} style={styles.pendingRow} testID={`offline-item-pending-${item.id}`}>
              <Text style={styles.itemLabel}>
                {ACTION_LABELS[item.type]} · {item.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#fef9c3',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fde68a',
    overflow: 'hidden',
  },
  containerAlert: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  spinner: { marginRight: 2 },
  summaryText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#854d0e' },
  summaryTextAlert: { color: '#991b1b' },
  chevron: { fontSize: 11, color: '#94a3b8' },
  list: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' },
  failedRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
  pendingRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
  itemLabel: { fontSize: 13, fontWeight: '600', color: '#334155' },
  itemError: { fontSize: 12, color: '#b91c1c', marginTop: 2 },
  itemActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
  retryText: { fontSize: 12, fontWeight: '700', color: '#2563eb' },
  dismissText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
});
