import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { MasterDataLayout } from './pages/masterData/MasterDataLayout';
import { MasterDataHome } from './pages/masterData/MasterDataHome';
import { ServiceCentresPage } from './pages/masterData/ServiceCentresPage';
import { FaultSymptomsPage } from './pages/masterData/FaultSymptomsPage';
import { SparePartsPage } from './pages/masterData/SparePartsPage';
import { SparePartModelsPage } from './pages/masterData/SparePartModelsPage';
import { PriceListsPage } from './pages/masterData/PriceListsPage';
import { KpiRulesPage } from './pages/masterData/KpiRulesPage';
import { NotificationTemplatesPage } from './pages/masterData/NotificationTemplatesPage';
import { WarrantyMasterPage } from './pages/masterData/WarrantyMasterPage';
import { ComponentYieldPage } from './pages/masterData/ComponentYieldPage';
import { AppointmentsLayout } from './pages/appointments/AppointmentsLayout';
import { AppointmentsHome } from './pages/appointments/AppointmentsHome';
import { SchedulePage } from './pages/appointments/SchedulePage';
import { FieldVisitsPage } from './pages/appointments/FieldVisitsPage';
import { JobCardsPage } from './pages/jobCards/JobCardsPage';
import { EstimatesPage } from './pages/estimates/EstimatesPage';
import { EstimatePublicPage } from './pages/estimates/EstimatePublicPage';
import { WorkshopInventoryLayout } from './pages/workshop/WorkshopInventoryLayout';
import { WorkshopInventoryHome } from './pages/workshop/WorkshopInventoryHome';
import { WorkshopPage } from './pages/workshop/WorkshopPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { QcPermissionsLayout } from './pages/qc/QcPermissionsLayout';
import { QcPermissionsHome } from './pages/qc/QcPermissionsHome';
import { QcPage } from './pages/qc/QcPage';
import { PermissionsPage } from './pages/qc/PermissionsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Public, unauthenticated customer link - deliberately outside ProtectedRoute
                /AppLayout entirely (no sidebar, no login requirement). See
                EstimatePublicPage's own doc comment and lib/publicApi.ts. */}
            <Route path="/estimate/:token" element={<EstimatePublicPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />

                <Route path="/master-data" element={<MasterDataLayout />}>
                  <Route index element={<MasterDataHome />} />
                  <Route path="service-centres" element={<ServiceCentresPage />} />
                  <Route path="fault-symptoms" element={<FaultSymptomsPage />} />
                  <Route path="spare-parts" element={<SparePartsPage />} />
                  <Route path="spare-part-models" element={<SparePartModelsPage />} />
                  <Route path="price-lists" element={<PriceListsPage />} />
                  <Route path="kpi-rules" element={<KpiRulesPage />} />
                  <Route path="notification-templates" element={<NotificationTemplatesPage />} />
                  <Route path="warranty-master" element={<WarrantyMasterPage />} />
                  <Route path="component-yield" element={<ComponentYieldPage />} />
                </Route>

                <Route path="/appointments" element={<AppointmentsLayout />}>
                  <Route index element={<AppointmentsHome />} />
                  <Route path="schedule" element={<SchedulePage />} />
                  <Route path="field-visits" element={<FieldVisitsPage />} />
                </Route>

                <Route path="/job-cards" element={<JobCardsPage />} />
                <Route path="/estimates" element={<EstimatesPage />} />

                <Route path="/workshop-inventory" element={<WorkshopInventoryLayout />}>
                  <Route index element={<WorkshopInventoryHome />} />
                  <Route path="workshop" element={<WorkshopPage />} />
                  <Route path="inventory" element={<InventoryPage />} />
                </Route>

                <Route path="/qc-permissions" element={<QcPermissionsLayout />}>
                  <Route index element={<QcPermissionsHome />} />
                  <Route path="qc" element={<QcPage />} />
                  <Route path="permissions" element={<PermissionsPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
