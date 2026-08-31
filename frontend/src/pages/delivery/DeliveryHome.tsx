import { Navigate } from 'react-router-dom';

// Same pattern as every other two-tab module's index route - land on the first real tab.
export function DeliveryHome() {
  return <Navigate to="/delivery/ready" replace />;
}
