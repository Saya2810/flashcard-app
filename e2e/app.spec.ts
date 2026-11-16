import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function newDeck(page: Page, name: string) {
  await page.goto('/#/stapel/neu');
  await page.getByTestId('in-deck-name').fill(name);
  await page.getByTestId('save-deck').click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('create a deck and a card, edit it, survive a reload, delete it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Willkommen!')).toBeVisible();
  await newDeck(page, 'Englisch');
  await page.getByTestId('deck-add-card').click();
  await page.getByTestId('in-front').fill('the library');
  await page.getByTestId('in-back').fill('die Bücherei');
  await page.getByTestId('save-card').click();
  await expect(page.getByTestId('detail-back')).toContainText('die Bücherei');

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByTestId('in-back').fill('die Bibliothek');
  await page.getByTestId('in-alt').fill('die Bücherei');
  await page.getByRole('radio', { name: /Priorität 5/ }).click();
  await page.getByTestId('save-card').click();
  await expect(page.getByText('auch: die Bücherei')).toBeVisible();

  await page.reload();
  await expect(page.getByText('auch: die Bücherei')).toBeVisible();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await page.goto('/#/karten');
  await expect(page.getByText('Noch keine Karten')).toBeVisible();
});

test('import several decks and lessons from CSV, study with a mistake, see statistics', async ({ page }) => {
  await page.goto('/#/import');
  await page.getByRole('radio', { name: 'CSV-Datei' }).click();
  const csv = '﻿Deck,Lesson,Front,Back,Umschrift\nPersisch,Lektion 1,آمدن,kommen,âmadan\nPersisch,Lektion 2,رفتن,gehen,raftan\nMathe,Ableitungen,Ableitung von $x^2$,$2x$,\n';
  await page.getByTestId('csv-input').setInputFiles({ name: 'karten.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByTestId('map-4')).toHaveValue('field');
  await expect(page.getByTestId('import-summary')).toContainText('3 werden importiert in 2 Stapel, 3 Lektionen');
  await page.getByTestId('run-import').click();
  await expect(page.getByTestId('deck-tile')).toHaveCount(2);

  await page.getByTestId('deck-tile').filter({ hasText: 'Mathe' }).click();
  await page.getByTestId('deck-learn').click();
  await page.getByTestId('flashcard').click();
  await expect(page.locator('[data-testid=answer] .katex').first()).toBeVisible();
  await page.getByTestId('btn-wrong').click();
  await page.getByTestId('flashcard').click();
  await page.getByTestId('btn-right').click();
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('sum-incorrect')).toHaveText('1');

  await page.goto('/#/statistik');
  await expect(page.getByText('Lernaktivität pro Tag')).toBeVisible();
  await expect(page.getByTestId('deck-stat')).toHaveCount(2);
});

test('typed-answer mode highlights differences and leaves the decision to the user', async ({ page }) => {
  await newDeck(page, 'Vokabeln');
  await page.goto('/#/import');
  await page.getByTestId('bulk-input').fill('the cat ; die Katze');
  await page.getByTestId('run-import').click();
  await expect(page.getByTestId('deck-learn')).toBeEnabled();
  await page.goto('/#/einstellungen');
  await page.getByTestId('toggle-typed').click();
  await page.goto('/#/lernen?modus=lesson');
  await page.getByTestId('start-session').click();
  await page.getByTestId('typed-input').fill('die Kaze');
  await page.getByTestId('typed-input').press('Enter');
  await expect(page.getByTestId('diff-solution').locator('ins')).toHaveText('t');
  await expect(page.getByTestId('btn-right')).toBeVisible();
  await page.getByTestId('btn-right').click();
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('sum-correct')).toHaveText('1');
});

test('download a backup and restore it after data loss', async ({ page }) => {
  await newDeck(page, 'Geschichte');
  await page.getByTestId('deck-add-card').click();
  await page.getByTestId('in-front').fill('Westfälischer Friede');
  await page.getByTestId('in-back').fill('1648');
  await page.getByTestId('save-card').click();
  await page.goto('/#/einstellungen');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('create-backup').click()]);
  const path = await download.path();
  const backup = JSON.parse(readFileSync(path!, 'utf8'));
  expect(backup.format).toBe('lernkarten-backup');
  expect(backup.data.cards[0].back).toBe('1648');

  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.deleteDatabase('lernkarten'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  await page.reload();
  await page.goto('/#/karten');
  await expect(page.getByText('Noch keine Karten')).toBeVisible();

  await page.goto('/#/einstellungen');
  await page.getByTestId('restore-input').setInputFiles(path!);
  await expect(page.getByTestId('restore-summary')).toContainText('1 Karte in 1 Stapel');
  await page.getByRole('button', { name: 'Zusammenführen' }).click();
  await page.goto('/#/karten');
  await expect(page.getByTestId('card-count')).toHaveText('1 Karte');

  await page.goto('/#/einstellungen');
  await page.getByTestId('restore-input').setInputFiles({ name: 'kaputt.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
  await expect(page.getByText('Sicherung nicht lesbar')).toBeVisible();
});

test('works offline after the first load (service worker)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByTestId('home-load-sample').click();
  await expect(page.getByTestId('start-learning')).toBeVisible();
  await page.reload();
  await context.setOffline(true);
  await page.goto('/#/');
  await page.reload();
  await expect(page.getByTestId('start-learning')).toBeVisible();
  await page.getByTestId('start-learning').click();
  await page.getByTestId('flashcard').click();
  await page.getByTestId('btn-right').click();
  await page.goto('/#/statistik');
  await expect(page.getByText('Lernaktivität pro Tag')).toBeVisible();
  await context.setOffline(false);
});

test('sample data loads and is removable; no page overflows horizontally', async ({ page }) => {
  await page.goto('/#/einstellungen');
  await page.getByTestId('load-sample').click();
  await page.goto('/#/stapel');
  await expect(page.getByTestId('deck-tile')).toHaveCount(4);
  for (const route of ['/', '/#/lernen', '/#/stapel', '/#/karten', '/#/problemkarten', '/#/statistik', '/#/einstellungen', '/#/import', '/#/stapel/neu', '/#/karten/neu']) {
    await page.goto(route);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal scrolling on ${route}`).toBeLessThanOrEqual(0);
  }
  await page.goto('/#/einstellungen');
  await page.getByTestId('remove-sample').click();
  await page.getByRole('button', { name: 'Beispiele entfernen' }).last().click();
  await page.goto('/#/stapel');
  await expect(page.getByText('Noch keine Stapel')).toBeVisible();
});
