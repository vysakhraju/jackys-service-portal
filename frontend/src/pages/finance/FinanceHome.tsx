import { Navigate } from 'react-router-dom';
import { useMyCapabilities } from '../../lib/useMyCapabilities';

// Same pattern as every other two-tab module's index route - land on the first real tab
// the caller can actually see. 2026-09-14: was an unconditional redirect to
// /finance/invoices - now that Invoices/Aging (INVOICING_MANAGE) and GL Postings
// (GL_LEDGER_VIEW) are gated by two different capabilities (see FinanceLayout.tsx's own
// comment), a caller granted only GL_LEDGER_VIEW would otherwise land on a tab FinanceLayout
// then blocks them from, instead of the one they can actually use.
export function FinanceHome() {
  const { has } = useMyCapabilities();
  const target = has('INVOICING_MANAGE') ? '/finance/invoices' : '/finance/gl-postings';
  return <Navigate to={target} replace />;
}
