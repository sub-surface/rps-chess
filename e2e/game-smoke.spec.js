import { expect, test } from '@playwright/test';

test('chooses 3x3 Skirmish, plays a move, and opens analysis', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/lobby', (route) => route.fulfill({ json: { games: [] } }));
  await page.route('**/api/showcase', (route) => route.fulfill({ json: { games: [] } }));

  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'home');
  await expect(page.getByRole('heading', { name: 'JANKEN' })).toBeVisible();
  await expect(page.locator('#home-botlevel')).toBeVisible();

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

test('the dedicated puzzle page marks a tablebase-winning move correct', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/puzzle');
  await expect(page.locator('#puzzle-board .pz-sq')).toHaveCount(9);
  await expect(page.locator('#puzzle-prompt')).toContainText('to play and win in');

  // The page must never duplicate the puzzle judgement. Ask the same tablebase for a top move,
  // then exercise the visible source and destination as a player would.
  const move = await page.evaluate(async () => {
    const E = await import('/engine.js');
    const TB = await import('/tablebase.js');
    const cfg = E.sanitizeCfg(E.PRESETS.skirmish);
    const oracle = await TB.oracleFor(cfg);
    const board = E.emptyBoard(TB.SIZE);
    const buttons = [...document.querySelectorAll('#puzzle-board .pz-sq')];
    for (let index = 0; index < buttons.length; index++) {
      const match = buttons[index].getAttribute('aria-label')?.match(/^(Blue|Red) (rock|paper|scissors) on /);
      if (!match) continue;
      board[(index / TB.SIZE) | 0][index % TB.SIZE].piece = {
        color: match[1] === 'Blue' ? E.BLUE : E.RED,
        type: match[2],
      };
    }
    const turn = document.getElementById('puzzle-prompt').textContent.startsWith('Blue') ? E.BLUE : E.RED;
    return TB.topMoves(TB.rankMoves(TB.movesFrom(oracle.table, board, turn, cfg)))[0];
  });

  await page.locator('#puzzle-board .pz-sq').nth(move.fr * 3 + move.fc).click();
  await page.locator('#puzzle-board .pz-sq').nth(move.tr * 3 + move.tc).click();
  await expect(page.locator('#puzzle-toast')).toHaveText(/Correct/);
  expect(pageErrors).toEqual([]);
});

test('the tablebase atlas loads a solved variant and answers a position', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/atlas');
  await expect(page.locator('#tb-board .tb-sq')).toHaveCount(9);

  // The shipped opening is drawn; the verdict is what proves the artifact decoded.
  await expect(page.locator('#verdict-word')).toHaveText('Draw');
  await expect(page.locator('#verdict')).toHaveClass(/draw/);
  await expect(page.locator('.move-row').first()).toBeVisible();

  // Every one of the 192 legal openings is in the gallery, and picking one keeps it drawn.
  await expect(page.locator('#fair-gallery .mini-board')).toHaveCount(192);
  await page.locator('#fair-gallery .mini-board').nth(40).click();
  await expect(page.locator('#verdict-word')).toHaveText('Draw');

  // Switching the movement archetype fetches another table and re-rules the same board.
  await page.locator('.variant-row[data-v="knight"]').click();
  await expect(page.locator('#stage-rules')).toContainText('all knights');
  await expect(page.locator('.gnode').first()).toBeVisible();

  expect(pageErrors).toEqual([]);
});
