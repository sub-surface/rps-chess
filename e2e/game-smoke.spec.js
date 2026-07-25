import { expect, test } from '@playwright/test';

test('chooses 3x3 Skirmish, plays a move, and opens analysis', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/lobby', (route) => route.fulfill({ json: { games: [] } }));
  await page.route('**/api/showcase', (route) => route.fulfill({ json: { games: [] } }));

  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'home');
  await expect(page.getByRole('heading', { name: 'JANKEN' })).toBeVisible();

  await page.getByRole('button', { name: 'Skirmish', exact: true }).click();
  await expect(page.locator('#play-variant')).toHaveText('Skirmish');
  await expect(page.locator('#s-size')).toHaveValue('3');
  await expect(page.locator('#s-per')).toHaveValue('1');

  await page.getByRole('button', { name: 'Over the board' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'game');
  await expect(page.locator('#board .sq')).toHaveCount(9);

  await page.locator('#board [aria-label^="Blue rock"]').click();
  await expect(page.locator('#board .target')).not.toHaveCount(0);
  await page.locator('#board .target').first().click();
  await expect(page.locator('#ply')).toHaveText('1 / 1');
  await expect(page.locator('#turn-label')).toContainText('Red to move');

  await page.locator('#analysis-btn').click();
  await expect(page.locator('#editpanel')).toBeVisible();
  await expect(page.locator('#board')).toHaveClass(/editing/);
  await expect(page.locator('#board .sq')).toHaveCount(9);
  expect(pageErrors).toEqual([]);
});
