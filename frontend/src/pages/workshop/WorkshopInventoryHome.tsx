import { Navigate } from 'react-router-dom';

// Same pattern as Appointments/Master Data's index route - land on the first real tab
// rather than a blank page.
export function WorkshopInventoryHome() {
  return <Navigate to="/workshop-inventory/workshop" replace />;
}
