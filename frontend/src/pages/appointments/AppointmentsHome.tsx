import { Navigate } from 'react-router-dom';

// Same pattern as Master Data's index route - land on the first real tab rather than a
// blank page.
export function AppointmentsHome() {
  return <Navigate to="/appointments/schedule" replace />;
}
