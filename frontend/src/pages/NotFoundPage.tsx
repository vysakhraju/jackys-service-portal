import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 text-slate-600">
      <p className="text-2xl font-semibold">404</p>
      <p className="text-sm">This page doesn't exist.</p>
      <Link to="/" className="mt-2 text-sm font-medium text-slate-900 underline">
        Back to dashboard
      </Link>
    </div>
  );
}
