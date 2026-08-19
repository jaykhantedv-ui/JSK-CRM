import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { FilterBar } from '@/components/shared/filter-bar'
import { Pagination } from '@/components/shared/pagination'
import { EmptyState, FilteredEmptyState, SkeletonRows } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import {
  CONSTRUCTION_STAGE_LABELS, PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, optionsFrom,
} from '@/lib/labels'
import { MOBILE_PAGE_SIZE, parsePageParams } from '@/lib/pagination'
import { listProjects, parseProjectFilters } from '@/services/project.service'

export const metadata: Metadata = { title: 'Projects · JSK CRM' }

/** The project list (§12.2). Filters: construction stage, city, status. */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as Record<string, string | undefined>

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <Link href="/projects/new" className={buttonClass('primary', 'sm')}>
          New site
        </Link>
      </header>

      <FilterBar
        searchPlaceholder="Site name"
        filters={[
          { key: 'stage', label: 'Build stage', options: optionsFrom(CONSTRUCTION_STAGE_LABELS) },
          { key: 'status', label: 'Status', options: optionsFrom(PROJECT_STATUS_LABELS) },
        ]}
      />

      <Suspense key={JSON.stringify(flat)} fallback={<SkeletonRows rows={6} />}>
        <ProjectList flat={flat} />
      </Suspense>
    </div>
  )
}

async function ProjectList({ flat }: { flat: Record<string, string | undefined> }) {
  const filters = parseProjectFilters(flat)
  const page = await listProjects(filters, parsePageParams(flat, MOBILE_PAGE_SIZE))

  if (page.rows.length === 0) {
    const filtered = Boolean(filters.q || filters.status || filters.constructionStage || filters.city)
    return filtered ? (
      <FilteredEmptyState clearHref="/projects" />
    ) : (
      <EmptyState
        title="No sites yet"
        description="Add a site once you know where the material is going — it can carry several enquiries."
        action={{ href: '/projects/new', label: 'Add site' }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {page.rows.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{project.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[PROJECT_TYPE_LABELS[project.project_type], project.city, project.area]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Badge tone={project.status === 'ACTIVE' ? 'active' : 'muted'}>
                {CONSTRUCTION_STAGE_LABELS[project.construction_stage]}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
      <Pagination page={page} basePath="/projects" searchParams={flat} />
    </div>
  )
}
