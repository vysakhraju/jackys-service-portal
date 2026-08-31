import { Navigate } from 'react-router-dom';

// Same pattern as Appointments/Workshop & Inventory's index route - land on the first
// real tab rather than a blank page.
export function QcPermissionsHome() {
  return <Navigate to="/qc-permissions/qc" replace />;
}
