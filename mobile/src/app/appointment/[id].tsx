import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FaultSymptomPicker } from '../../components/FaultSymptomPicker';
import { StatusPill } from '../../components/StatusPill';
import { getCurrentLocationOrBlock } from '../../lib/location';
import { listFaultSymptoms } from '../../lib/masterDataApi';
import { captureFaultSymptom, captureSerialNumber, getVisit, startVisit } from '../../lib/technicianApi';
import type { FaultSymptom, ScheduledAppointment } from '../../lib/types';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Statuses a visit can still be started from - mirrors the backend's markOnSite guard
// (AppointmentsService.markOnSite only allows CONFIRMED/TECHNICIAN_ASSIGNED -> ON_SITE).
// SCHEDULED is included here too so the button is offered rather than hidden - tapping
// it surfaces the backend's real "not confirmed/assigned yet" error instead of silently
// looking like there's nothing to do on this appointment.
const STARTABLE_STATUSES = new Set(['SCHEDULED', 'CONFIRMED', 'TECHNICIAN_ASSIGNED']);

const WARRANTY_LABELS: Record<string, string> = { IW: 'In Warranty', OOW: 'Out of Warranty' };

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(' ');
  }
  return fallback;
}

export default function AppointmentDetailScreen() {
  const params = useLocalSearchParams<{ id: string; appt?: string }>();
  const queryClient = useQueryClient();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationBlockedPermanently, setLocationBlockedPermanently] = useState(false);

  const appointment: ScheduledAppointment | null = useMemo(() => {
    if (!params.appt) return null;
    try {
      return JSON.parse(params.appt) as ScheduledAppointment;
    } catch {
      return null;
    }
  }, [params.appt]);

  const {
    data: visit,
    error: visitError,
    isLoading: visitLoading,
  } = useQuery({
    queryKey: ['technician-visit', params.id],
    queryFn: () => getVisit(params.id),
    enabled: Boolean(params.id),
    retry: false,
  });
  const visitNotFound = isAxiosError(visitError) && visitError.response?.status === 404;

  function invalidateVisit() {
    queryClient.invalidateQueries({ queryKey: ['technician-visit', params.id] });
    queryClient.invalidateQueries({ queryKey: ['technician-schedule'] });
  }

  const startMutation = useMutation({
    mutationFn: (input: { gpsLat: number; gpsLng: number }) => startVisit(params.id, input),
    onSuccess: invalidateVisit,
  });

  async function handleStartVisit() {
    setLocationError(null);
    setLocationBlockedPermanently(false);
    setLocating(true);
    try {
      const result = await getCurrentLocationOrBlock();
      if (!result.ok) {
        setLocationError(result.message);
        setLocationBlockedPermanently(result.reason === 'permission-denied-permanently');
        return;
      }
      try {
        await startMutation.mutateAsync({ gpsLat: result.coords.latitude, gpsLng: result.coords.longitude });
      } catch {
        // Already captured in startMutation.isError/.error for the UI below - nothing
        // else to do with the rejection here.
      }
    } finally {
      setLocating(false);
    }
  }

  // --- Serial number + warranty (Phase 3) ---
  const [serialNumberInput, setSerialNumberInput] = useState('');
  const [brandInput, setBrandInput] = useState(appointment?.brand ?? '');

  const serialMutation = useMutation({
    mutationFn: () => captureSerialNumber(params.id, { serialNumber: serialNumberInput.trim(), brand: brandInput.trim() || undefined }),
    onSuccess: () => {
      invalidateVisit();
      setSerialNumberInput('');
    },
  });

  // --- Fault + symptom (Phase 3) ---
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedFaultSymptom, setSelectedFaultSymptom] = useState<FaultSymptom | null>(null);

  const {
    data: faultSymptoms,
    error: faultSymptomsError,
    isLoading: faultSymptomsLoading,
  } = useQuery({
    queryKey: ['fault-symptoms'],
    queryFn: () => listFaultSymptoms(),
    enabled: Boolean(visit?.serialNumber),
    staleTime: 5 * 60 * 1000,
  });

  const faultSymptomMutation = useMutation({
    mutationFn: () =>
      captureFaultSymptom(params.id, {
        faultCode: selectedFaultSymptom!.faultCode,
        symptomCode: selectedFaultSymptom!.symptomCode,
      }),
    onSuccess: () => {
      invalidateVisit();
      setSelectedFaultSymptom(null);
    },
  });

  if (!appointment) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerFill}>
          <Text style={styles.errorText} testID="appointment-detail-error">
            Couldn&apos;t load this appointment. Go back and try again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const canStart = STARTABLE_STATUSES.has(appointment.status) && visitNotFound;
  const busy = locating || startMutation.isPending;
  const canCaptureFaultSymptom = Boolean(visit?.serialNumber);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="back-button" hitSlop={12}>
          <Text style={styles.backText}>‹ Schedule</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.time}>{formatDateTime(appointment.scheduledAt)}</Text>
            <StatusPill status={appointment.status} />
          </View>
          <Text style={styles.appointmentNumber}>{appointment.appointmentNumber}</Text>
          <Text style={styles.customerName}>{appointment.customerName}</Text>
          <Text style={styles.meta}>{appointment.customerPhone}</Text>
          {appointment.customerAddress && (
            <Text style={styles.meta}>
              {[appointment.customerAddress, appointment.customerCity].filter(Boolean).join(', ')}
            </Text>
          )}
          {(appointment.brand || appointment.modelNumber) && (
            <Text style={styles.meta}>{[appointment.brand, appointment.modelNumber].filter(Boolean).join(' · ')}</Text>
          )}
          {appointment.problemDescription && <Text style={styles.problem}>{appointment.problemDescription}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Visit</Text>

          {visitLoading && <ActivityIndicator style={styles.spinner} />}

          {visit && (
            <View testID="visit-started">
              <Text style={styles.visitStartedText}>Visit started {formatDateTime(visit.startedAt)}</Text>
              <Text style={styles.meta}>Location captured ✓</Text>
            </View>
          )}

          {!visitLoading && !visit && !canStart && (
            <Text style={styles.meta}>
              This appointment isn&apos;t ready to start yet - it needs to be confirmed and assigned first.
            </Text>
          )}

          {!visitLoading && !visit && canStart && (
            <View>
              {locationError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorBoxText} testID="location-error">
                    {locationError}
                  </Text>
                  {locationBlockedPermanently && (
                    <Pressable onPress={() => Linking.openSettings()} testID="open-settings">
                      <Text style={styles.linkText}>Open Settings</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {startMutation.isError && !locationError && (
                <Text style={styles.errorBoxText} testID="start-visit-error">
                  {extractErrorMessage(startMutation.error, 'Could not start the visit. Try again.')}
                </Text>
              )}
              <Pressable
                style={[styles.button, busy && styles.buttonDisabled]}
                onPress={handleStartVisit}
                disabled={busy}
                testID="start-visit-button"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Start Visit</Text>}
              </Pressable>
              <Text style={styles.hint}>Captures your GPS location and the time you arrived.</Text>
            </View>
          )}
        </View>

        {visit && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Serial number &amp; warranty</Text>

            {visit.serialNumber && (
              <View style={styles.capturedBox} testID="serial-number-captured">
                <View style={styles.capturedRow}>
                  <Text style={styles.capturedValue}>{visit.serialNumber}</Text>
                  {visit.warrantyStatus && (
                    <StatusPill status={visit.warrantyStatus} label={WARRANTY_LABELS[visit.warrantyStatus]} />
                  )}
                </View>
                {visit.warrantySupplier && (
                  <Text style={styles.meta}>
                    Supplier: {visit.warrantySupplier}
                    {visit.warrantyPeriodMonths ? ` · ${visit.warrantyPeriodMonths} months` : ''}
                  </Text>
                )}
                <Text style={styles.hint}>
                  Re-capturing below clears the fault/symptom recorded for this visit - the
                  backend requires the current, validated serial number before fault/symptom
                  can be recorded.
                </Text>
              </View>
            )}

            {serialMutation.isError && (
              <Text style={styles.errorBoxText} testID="serial-number-error">
                {extractErrorMessage(serialMutation.error, 'Could not capture the serial number. Try again.')}
              </Text>
            )}

            <TextInput
              style={styles.input}
              placeholder="Serial number"
              value={serialNumberInput}
              onChangeText={setSerialNumberInput}
              autoCapitalize="characters"
              testID="serial-number-input"
            />
            <TextInput
              style={styles.input}
              placeholder="Brand (optional)"
              value={brandInput}
              onChangeText={setBrandInput}
              testID="brand-input"
            />
            <Pressable
              style={[styles.button, (!serialNumberInput.trim() || serialMutation.isPending) && styles.buttonDisabled]}
              onPress={() => serialMutation.mutate()}
              disabled={!serialNumberInput.trim() || serialMutation.isPending}
              testID="capture-serial-number-button"
            >
              {serialMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{visit.serialNumber ? 'Re-capture' : 'Capture'}</Text>
              )}
            </Pressable>
          </View>
        )}

        {visit && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Fault &amp; symptom</Text>

            {!canCaptureFaultSymptom && (
              <Text style={styles.meta} testID="fault-symptom-locked-hint">
                Capture the serial number first - the backend blocks this until then.
              </Text>
            )}

            {canCaptureFaultSymptom && (
              <View>
                {visit.faultCode && (
                  <View style={styles.capturedBox} testID="fault-symptom-captured">
                    <Text style={styles.capturedValue}>
                      {visit.faultCode} · {visit.symptomCode}
                    </Text>
                  </View>
                )}

                {faultSymptomMutation.isError && (
                  <Text style={styles.errorBoxText} testID="fault-symptom-error">
                    {extractErrorMessage(faultSymptomMutation.error, 'Could not record fault/symptom. Try again.')}
                  </Text>
                )}

                {selectedFaultSymptom && (
                  <View style={styles.capturedBox} testID="fault-symptom-selection">
                    <Text style={styles.capturedValue}>{selectedFaultSymptom.faultDescription}</Text>
                    <Text style={styles.meta}>{selectedFaultSymptom.symptomDescription}</Text>
                  </View>
                )}

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setPickerVisible(true)}
                  testID="open-fault-symptom-picker"
                >
                  <Text style={styles.secondaryButtonText}>
                    {selectedFaultSymptom ? 'Change selection' : 'Choose fault / symptom'}
                  </Text>
                </Pressable>

                {selectedFaultSymptom && (
                  <Pressable
                    style={[styles.button, faultSymptomMutation.isPending && styles.buttonDisabled]}
                    onPress={() => faultSymptomMutation.mutate()}
                    disabled={faultSymptomMutation.isPending}
                    testID="capture-fault-symptom-button"
                  >
                    {faultSymptomMutation.isPending ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>{visit.faultCode ? 'Re-capture' : 'Capture'}</Text>
                    )}
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <FaultSymptomPicker
        visible={pickerVisible}
        items={faultSymptoms}
        loading={faultSymptomsLoading}
        error={faultSymptomsError ? extractErrorMessage(faultSymptomsError, 'Could not load fault/symptom codes.') : null}
        onSelect={(item) => {
          setSelectedFaultSymptom(item);
          setPickerVisible(false);
        }}
        onClose={() => setPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  backText: { fontSize: 15, color: '#2563eb', fontWeight: '500' },
  content: { padding: 16, gap: 12 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorText: { color: '#b91c1c', fontSize: 14, textAlign: 'center' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  time: { fontSize: 14, fontWeight: '600', color: '#334155' },
  appointmentNumber: { fontSize: 12, color: '#94a3b8', marginBottom: 4 },
  customerName: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  meta: { fontSize: 14, color: '#64748b', marginBottom: 4 },
  problem: { fontSize: 14, color: '#334155', marginTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  spinner: { marginVertical: 8 },
  visitStartedText: { fontSize: 15, fontWeight: '600', color: '#166534', marginBottom: 4 },
  errorBox: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 10, marginBottom: 12 },
  errorBoxText: { color: '#b91c1c', fontSize: 13, marginBottom: 8 },
  linkText: { color: '#2563eb', fontSize: 13, fontWeight: '600', marginTop: 6 },
  button: { backgroundColor: '#0f172a', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },
  secondaryButton: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  secondaryButtonText: { color: '#334155', fontWeight: '600', fontSize: 15 },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 8, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  capturedBox: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 12 },
  capturedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  capturedValue: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
});
