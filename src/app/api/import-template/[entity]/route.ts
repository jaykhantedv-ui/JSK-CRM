import { CSV_CONTENT_TYPE } from '@/lib/csv'
import { IMPORT_ENTITIES, templateCsv, type ImportEntity } from '@/lib/import/templates'
import { isOwnerOrAdmin } from '@/lib/permissions'
import { getCurrentUser } from '@/services/auth.service'

/**
 * The blank import template (§20.2).
 *
 * Headers only — **no sample row**. A fixture that ships looks like data, and a
 * business importing its own customer list must not find an invented "Ravi Kumar"
 * in the file it is about to fill in (CLAUDE.md §15).
 *
 * OWNER/ADMIN only, like the rest of import, and it answers a STATUS rather than
 * a redirect: a script fetching this must be able to tell refusal from success
 * by the status line.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Sign in to continue.' }, { status: 401 })
  if (!isOwnerOrAdmin(user)) {
    return Response.json({ error: 'Only the owner or an administrator can import.' }, { status: 403 })
  }

  const { entity } = await params
  if (!(IMPORT_ENTITIES as readonly string[]).includes(entity)) {
    return Response.json({ error: 'Unknown template.' }, { status: 404 })
  }

  return new Response(templateCsv(entity as ImportEntity), {
    headers: {
      'content-type': CSV_CONTENT_TYPE,
      'content-disposition': `attachment; filename="jsk-${entity}-template.csv"`,
    },
  })
}
