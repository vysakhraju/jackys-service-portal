import { Navigate } from 'react-router-dom';

// The Master Data landing route just sends people to the first tab —
// MasterDataLayout's sub-nav is the real "home" for this module.
export function MasterDataHome() {
  return <Navigate to="/master-data/service-centres" replace />;
}
