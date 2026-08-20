'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  optionalField, requireField, stateFromError, valuesFrom, type FormState,
} from '@/lib/form-state'
import { rupeesToPaise } from '@/lib/money'
import {
  addProjectStakeholder, createProject, removeProjectStakeholder, setPrimaryStakeholder,
  updateProject,
} from '@/services/project.service'
import { createContact } from '@/services/contact.service'

const intField = (formData: FormData, name: string): number | null => {
  const raw = optionalField(formData, name)
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function projectInput(formData: FormData) {
  const estimated = optionalField(formData, 'estimatedValue')
  return {
    name: requireField(formData, 'name', 'Give this site a name.'),
    accountId: requireField(formData, 'accountId', 'Choose the customer.'),
    outletId: requireField(formData, 'outletId', 'Choose the branch.'),
    projectType: requireField(formData, 'projectType', 'Choose the type of site.') as never,
    constructionStage: (optionalField(formData, 'constructionStage') ?? 'UNKNOWN') as never,
    status: (optionalField(formData, 'status') ?? 'ACTIVE') as never,
    siteAddress: optionalField(formData, 'siteAddress'),
    city: optionalField(formData, 'city'),
    area: optionalField(formData, 'area'),
    builtupAreaSqft: intField(formData, 'builtupAreaSqft'),
    floors: intField(formData, 'floors'),
    bathrooms: intField(formData, 'bathrooms'),
    expectedFlooringDate: optionalField(formData, 'expectedFlooringDate'),
    estimatedValuePaise: estimated ? rupeesToPaise(estimated) : null,
    notes: optionalField(formData, 'notes'),
  }
}

export async function createProjectAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)
  let projectId: string

  try {
    const project = await createProject(projectInput(formData))
    projectId = project.id
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath('/projects')
  redirect(`/projects/${projectId}`)
}

export async function updateProjectAction(
  projectId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    await updateProject(projectId, projectInput(formData))
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(`/projects/${projectId}`)
  redirect(`/projects/${projectId}`)
}

/**
 * §11.4 — add somebody to a project.
 *
 * Either an existing contact is chosen, or one is created inline in the same
 * submit. Making the salesperson leave the project, create a contact, and come
 * back would lose the multi-stakeholder flow §4.4 exists to support.
 */
export async function addStakeholderAction(
  projectId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesFrom(formData)

  try {
    let contactId = optionalField(formData, 'contactId') ?? null
    const accountId = optionalField(formData, 'accountId') ?? null
    const newName = optionalField(formData, 'newContactName')

    if (!contactId && !accountId && newName) {
      const contact = await createContact({
        fullName: newName,
        phone: optionalField(formData, 'newContactPhone'),
        email: optionalField(formData, 'newContactEmail'),
        role: (optionalField(formData, 'role') ?? 'OTHER') as never,
        influence: (optionalField(formData, 'influence') ?? 'INFLUENCER') as never,
      })
      contactId = contact.id
    }

    await addProjectStakeholder({
      projectId,
      contactId,
      accountId,
      role: requireField(formData, 'role', 'Choose their role on this site.') as never,
      influence: (optionalField(formData, 'influence') ?? 'INFLUENCER') as never,
      isPrimary: formData.get('isPrimary') === '1',
      notes: optionalField(formData, 'notes'),
    })
  } catch (error) {
    return stateFromError(error, values)
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true, error: null, fieldErrors: {} }
}

/**
 * ADR-004 — the single approved hard delete in the schema. A stakeholder row is a
 * relationship link, so removing a wrongly-added person is a correction rather
 * than the destruction of a record.
 */
export async function removeStakeholderAction(
  projectId: string,
  stakeholderId: string,
): Promise<FormState> {
  try {
    await removeProjectStakeholder(stakeholderId)
  } catch (error) {
    return stateFromError(error)
  }
  revalidatePath(`/projects/${projectId}`)
  return { ok: true, error: null, fieldErrors: {} }
}

/** §5.6 — at most one primary per project, arbitrated by the partial unique index. */
export async function setPrimaryStakeholderAction(
  projectId: string,
  stakeholderId: string,
): Promise<FormState> {
  try {
    await setPrimaryStakeholder(projectId, stakeholderId)
  } catch (error) {
    return stateFromError(error)
  }
  revalidatePath(`/projects/${projectId}`)
  return { ok: true, error: null, fieldErrors: {} }
}
