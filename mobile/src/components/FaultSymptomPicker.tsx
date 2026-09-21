// Full-screen picker for Fault + Symptom capture (Phase 3, cascaded per #301 - 2026-09-21).
// GET /master-data/fault-symptoms rows are no longer one fault+symptom PAIR each in the
// sense of a unique combo - symptomCode is deliberately non-unique now, since many faults
// can share one customer-reported symptom (e.g. 50 washing machine models, one symptom
// set, several possible diagnoses per symptom). So this picker is two steps, mirroring the
// web app's WorkshopIntakeModal: pick the Symptom (customer complaint) first, then the
// Fault the technician diagnosed from among the rows recorded against that symptom.
import { useEffect, useMemo, useState } from 'react';
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

interface SymptomOption {
  symptomCode: string;
  symptomDescription: string;
}

function matchesSymptom(option: SymptomOption, query: string): boolean {
  return `${option.symptomCode} ${option.symptomDescription}`.toLowerCase().includes(query.toLowerCase());
}

function matchesFault(item: FaultSymptom, query: string): boolean {
  return `${item.faultCode} ${item.faultDescription}`.toLowerCase().includes(query.toLowerCase());
}
export function FaultSymptomPicker({ visible, items, loading, error, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedSymptomCode, setSelectedSymptomCode] = useState<string | null>(null);

  // Reset to step one whenever the picker (re)opens, so a previous session's symptom
  // choice doesn't linger into the next.
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedSymptomCode(null);
    }
  }, [visible]);

  // Distinct symptoms (customer complaints) for step one - dedupe by symptomCode since
  // many rows (one per possible fault) can now share the same symptom.
  const symptomOptions = useMemo<SymptomOption[]>(() => {
    if (!items) return [];
    const seen = new Map<string, SymptomOption>();
    for (const item of items) {
      if (!seen.has(item.symptomCode)) {
        seen.set(item.symptomCode, { symptomCode: item.symptomCode, symptomDescription: item.symptomDescription });
      }
    }
    return Array.from(seen.values());
  }, [items]);

  const selectedSymptom = symptomOptions.find((option) => option.symptomCode === selectedSymptomCode);

  // Step two: only the rows recorded against the chosen symptom.
  const faultOptions = useMemo(() => {
    if (!items || !selectedSymptomCode) return [];
    return items.filter((item) => item.symptomCode === selectedSymptomCode);
  }, [items, selectedSymptomCode]);

  const filteredSymptoms = useMemo(() => {
    if (!query.trim()) return symptomOptions;
    return symptomOptions.filter((option) => matchesSymptom(option, query.trim()));
  }, [symptomOptions, query]);

  const filteredFaults = useMemo(() => {
    if (!query.trim()) return faultOptions;
    return faultOptions.filter((item) => matchesFault(item, query.trim()));
  }, [faultOptions, query]);

  function handleSymptomSelect(option: SymptomOption) {
    setSelectedSymptomCode(option.symptomCode);
    setQuery('');
  }

  function handleBack() {
    setSelectedSymptomCode(null);
    setQuery('');
  }

  const step: 'symptom' | 'fault' = selectedSymptomCode ? 'fault' : 'symptom';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="fault-symptom-picker">
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {step === 'fault' && (
              <Pressable onPress={handleBack} testID="fault-symptom-picker-back" hitSlop={12} style={styles.backButton}>
                <Text style={styles.closeText}>‹ Back</Text>
              </Pressable>
            )}
            <Text style={styles.title}>{step === 'symptom' ? 'Select symptom' : 'Select fault'}</Text>
          </View>
          <Pressable onPress={onClose} testID="fault-symptom-picker-close" hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        {step === 'fault' && selectedSymptom && (
          <Text style={styles.subtitle}>For: {selectedSymptom.symptomDescription}</Text>
        )}

        <TextInput
          style={styles.search}
          placeholder={step === 'symptom' ? 'Search symptoms (e.g. not cooling, no power)' : 'Search faults (e.g. compressor, thermostat)'}
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

        {!loading && !error && step === 'symptom' && (
          <FlatList
            data={filteredSymptoms}
            keyExtractor={(option) => option.symptomCode}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.emptyText}>No matching symptoms.</Text>}
            renderItem={({ item: option }) => (
              <Pressable
                style={styles.row}
                onPress={() => handleSymptomSelect(option)}
                testID={`fault-symptom-symptom-option-${option.symptomCode}`}
              >
                <Text style={styles.faultText}>{option.symptomDescription}</Text>
                <Text style={styles.codeText}>{option.symptomCode}</Text>
              </Pressable>
            )}
          />
        )}

        {!loading && !error && step === 'fault' && (
          <FlatList
            data={filteredFaults}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.emptyText}>No matching fault codes.</Text>}
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { marginRight: 2 },
  title: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#475569', paddingHorizontal: 20, paddingBottom: 4 },
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
