import { Navigate } from 'react-router-dom';

// Same pattern as every other multi-tab module's index route - land on the first real tab.
export function AmcHome() {
  return <Navigate to="/amc/contracts" replace />;
}
