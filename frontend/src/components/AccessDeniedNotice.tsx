// Shared pre-emptive "you can't be here" panel - for a whole section/page a
// useMyCapabilities() check has already decided the current user shouldn't see, before
// any query even fires (unlike ErrorNotice's after-the-fact 403 hint, which reacts to a
// request that was already made and rejected). Kept deliberately plain and reusable
// rather than one bespoke message per page - see MasterDataLayout.tsx for the first use.
export function AccessDeniedNotice({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-md rounded-md border border-slate-200 bg-white px-4 py-6 text-center">
      <p className="text-sm font-medium text-slate-700">You don't have access to {what} yet.</p>
      <p className="mt-1 text-sm text-slate-500">
        A Super Admin can grant it under Users → Designation access - it takes effect immediately, no re-login
        needed.
      </p>
    </div>
  );
}
