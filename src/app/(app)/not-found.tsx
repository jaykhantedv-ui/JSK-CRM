import { ForbiddenState } from '@/components/shared/states'

/**
 * §12.6 / §25 — the same words for "not yours" as for "not there".
 *
 * A 404 that said "no such customer" while a 403 said "not your customer" would
 * turn the URL bar into a way of enumerating other people's records.
 */
export default function NotFound() {
  return (
    <div className="py-8">
      <ForbiddenState />
    </div>
  )
}
