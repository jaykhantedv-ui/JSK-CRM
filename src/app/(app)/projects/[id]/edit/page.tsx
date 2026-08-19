import type { Metadata } from 'next'

import { updateProjectAction } from '@/features/projects/actions'
import { ProjectForm } from '@/features/projects/project-form'
import { resolveDefaultOutlet } from '@/services/account.service'
import { requireUser } from '@/services/auth.service'
import { getProject } from '@/services/project.service'
import { cityOptions, outletOptions } from '@/services/reference.service'

export const metadata: Metadata = { title: 'Edit site · JSK CRM' }

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [project, outlets, cities] = await Promise.all([getProject(id), outletOptions(), cityOptions()])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Edit {project.name}</h1>
      <ProjectForm
        action={updateProjectAction.bind(null, id)}
        project={project}
        accountOptions={[]}
        outletOptions={outlets}
        defaultOutletId={resolveDefaultOutlet(user)}
        cities={cities}
        submitLabel="Save changes"
      />
    </div>
  )
}
