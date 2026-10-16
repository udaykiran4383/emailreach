import { expect, test } from '@playwright/test'
import crypto from 'crypto'
import { q } from '../helpers'

test.describe('auth', () => {
  test('sign up through the UI, then sign in and land on the dashboard', async ({ page }) => {
    const email = `ui-${crypto.randomBytes(3).toString('hex')}@example.org`
    const password = 'Correct-Horse-9'

    await page.goto('/auth/signup')
    await page.locator('input[type="email"]').fill(email)
    const passwords = page.locator('input[type="password"]')
    await passwords.nth(0).fill(password)
    if ((await passwords.count()) > 1) await passwords.nth(1).fill(password)
    await page.getByRole('button', { name: /sign up|create account/i }).first().click()
    await expect(page.getByText(/account created/i)).toBeVisible()
    expect(await q('SELECT id FROM auth.users WHERE email = $1', [email])).toHaveLength(1)

    await page.goto('/auth/login')
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(password)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.waitForURL('**/dashboard')
    await expect(page.getByText('EmailReach').first()).toBeVisible()
  })

  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/auth/login')
    await page.locator('#email').fill('nobody@example.org')
    await page.locator('#password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await expect(page.getByText(/invalid login credentials|error/i).first()).toBeVisible()
    expect(page.url()).toContain('/auth/login')
  })

  test('dashboard redirects to login when signed out', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL('**/auth/login')
  })
})
