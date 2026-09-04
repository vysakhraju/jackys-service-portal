// Full-screen picker for Fault + Symptom capture (Phase 3). Each row from
// GET /master-data/fault-symptoms is one fault+symptom PAIR - not two independent lists
// - so this picker selects a whole row rather than combining separate fault/symptom
// fields, matching how the backend actually models it
// (src/master-data/entities/fault-symptom.entity.ts).
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FaultSymptom } from '../lib/types';

interface Props {
  visible: boolean;
  items: FaultSymptom[] | undefined;
  loading?: boolean;
  error?: string | null;
  onSelect: (item: FaultSymptom) => void;
  onClose: () => void;
}

function matches(item: FaultSymptom, query: string): boolean {
  const haystack = `${item.faultCode} ${item.faultDescription} ${item.symptomCode} ${item.symptomDescription}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function FaultSymptomPicker({ visible, items, loading, error, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!items) return [];
    if (!query.trim()) return items;
    return items.filter((item) => matches(item, query.trim()));
  }, [items, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="fault-symptom-picker">
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Select fault &amp; symptom</Text>
          <Pressable onPress={onClose} testID="fault-symptom-picker-close" hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search (e.g. not cooling, no power)"
          value={query}
          onChangeText={setQuery}
          testID="fault-symptom-search"
          autoCapitalize="none"
        />

        {loading && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <Text style={styles.errorText} testID="fault-symptom-list-error">
            {error}
          </Text>
        )}

        {!loading && !error && (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No matching fault/symptom codes.</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => onSelect(item)}
                testID={`fault-symptom-option-${item.id}`}
              >
                <Text style={styles.faultText}>{item.faultDescription}</Text>
                <Text style={styles.symptomText}>{item.symptomDescription}</Text>
                <Text style={styles.codeText}>
                  {item.faultCode} · {item.symptomCode}
                </Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  closeText: { fontSize: 15, color: '#2563eb', fontWeight: '500' },
  search: {
    marginHorizontal: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
  spinner: { marginTop: 24 },
  errorText: { color: '#b91c1c', fontSize: 13, textAlign: 'center', marginTop: 16, paddingHorizontal: 16 },
  emptyText: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginTop: 24 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 8,
  },
  faultText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  symptomText: { fontSize: 13, color: '#475569', marginTop: 2 },
  codeText: { fontSize: 11, color: '#94a3b8', marginTop: 6 },
});
