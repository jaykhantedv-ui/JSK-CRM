/**
 * The placeholder every not-yet-built screen renders.
 *
 * It shows NOTHING that looks like data. No sample rows, no placeholder chart, no
 * invented metric — a screen that is not built must look unbuilt, or a phase
 * demo becomes a lie (CLAUDE.md §15).
 */
export function NotImplemented({ screen, phase }: { screen: string; phase: string }) {
  return (
    <section className="flex flex-col gap-2 py-10">
      <h1 className="text-xl font-semibold tracking-tight">{screen}</h1>
      <p className="max-w-prose text-sm text-neutral-600">
        Not built yet. This screen arrives in {phase}. Nothing is shown here rather than
        placeholder figures.
      </p>
    </section>
  )
}
