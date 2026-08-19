/**
 * Phase 1 boot page.
 *
 * This exists only to prove the application shell renders. It is replaced in
 * Phase 4 by the role-based redirect defined in §12.2 (SALESPERSON → /today,
 * MANAGER/OWNER → /dashboard, ADMIN → /settings per decision M-01).
 *
 * It deliberately contains no CRM data, no metrics and no placeholder figures
 * (CLAUDE.md §15).
 */
export default function RootPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">JSK CRM</h1>
      <p className="text-muted-foreground text-sm">
        Application foundation. No functionality is implemented yet.
      </p>
    </main>
  )
}
