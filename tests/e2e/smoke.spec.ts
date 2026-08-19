import { expect, test } from '@playwright/test'

/**
 * Phase 1 infrastructure test. It proves the application boots and the App Router
 * shell renders.
 *
 * The fifteen required end-to-end scenarios (§19.3) arrive with the features they
 * cover, from Phase 8 onward.
 */
test('the application boots and renders the shell', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'JSK CRM' })).toBeVisible()
  await expect(page).toHaveTitle('JSK CRM')
})
