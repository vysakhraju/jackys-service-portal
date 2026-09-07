// Full-screen picker for Need Spare (Mobile Phase 5). Mirrors FaultSymptomPicker's shape
// exactly (fetch once, filter client-side, select a row) - GET /master-data/spare-parts
// has no server-side free-text search either.
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SparePart } from '../lib/types';

interface Props {
  visible: boolean;
  items: SparePart[] | undefined;
  loading?: boolean;
  error?: string | null;
  onSelect: (item: SparePart) => void;
  onClose: () => void;
}

function matches(item: SparePart, query: string): boolean {
  const haystack = `${item.code} ${item.name} ${item.category} ${item.brand ?? ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function SparePartPicker({ visible, items, loading, error, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!items) return [];
    if (!query.trim()) return items;
    return items.filter((item) => matches(item, query.trim()));
  }, [items, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="spare-part-picker">
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Select spare part</Text>
          <Pressable onPress={onClose} testID="spare-part-picker-close" hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search by name, code, or brand"
          value={query}
          onChangeText={setQuery}
          testID="spare-part-search"
          autoCapitalize="none"
        />

        {loading && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <Text style={styles.errorText} testID="spare-part-list-error">
            {error}
          </Text>
        )}

        {!loading && !error && (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.emptyText}>No matching spare parts.</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => onSelect(item)} testID={`spare-part-option-${item.id}`}>
                <Text style={styles.nameText}>{item.name}</Text>
                <Text style={styles.metaText}>
                  {item.code}
                  {item.brand ? ` · ${item.brand}` : ''} · {item.category}
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
  nameText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  metaText: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
});
