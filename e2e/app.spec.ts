import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function addWord(page: Page, persian: string, german: string) {
  await page.goto('/#/vokabeln/neu');
  await page.getByTestId('in-persian').fill(persian);
  await page.getByTestId('in-german').fill(german);
  await page.getByTestId('save-vocab').click();
  await expect(page.getByRole('heading', { name: 'Vokabel', exact: true })).toBeVisible();
}

test('create, edit, survive reload, delete an item', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Noch keine Vokabeln')).toBeVisible();
  await addWord(page, 'آمدن', 'kommen');
  await expect(page.locator('bdi[lang="fa"][dir="rtl"]').first()).toHaveText('آمدن');

  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByTestId('in-german').fill('kommen, ankommen');
  await page.getByTestId('in-german').fill('kommen');
  await page.getByTestId('in-alt').fill('ankommen');
  await page.getByRole('radio', { name: /Priorität 5/ }).click();
  await page.getByTestId('save-vocab').click();
  await expect(page.getByText('auch: ankommen')).toBeVisible();

  await page.reload();
  await expect(page.getByText('auch: ankommen')).toBeVisible();
  await page.goto('/#/vokabeln');
  await expect(page.getByTestId('vocab-count')).toHaveText('1 Vokabel');

  await page.getByRole('link', { name: /kommen/ }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByText('Noch keine Vokabeln')).toBeVisible();
});

test('create a lesson, study with a mistake, check stats and problem words', async ({ page }) => {
  await page.goto('/#/lektionen');
  await page.getByRole('button', { name: 'Lektion anlegen' }).first().click();
  await page.getByTestId('in-lesson-name').fill('Persisch III – Lektion 1');
  await page.getByTestId('save-lesson').click();
  await expect(page.getByTestId('lesson-card')).toContainText('Persisch III – Lektion 1');

  await page.goto('/#/vokabeln/import');
  await page.getByTestId('bulk-input').fill('آمدن ; kommen\nرفتن ; gehen\nماندن ; bleiben');
  await expect(page.getByTestId('import-summary')).toContainText('3 werden importiert');
  await page.getByTestId('run-import').click();
  await expect(page.getByTestId('vocab-count')).toHaveText('3 Vokabeln');

  // Session: first card wrong, the rest correct
  await page.goto('/');
  await page.getByTestId('start-learning').click();
  const card = page.getByTestId('flashcard');
  await expect(card).toHaveAttribute('data-flipped', 'false');
  await card.click();
  await expect(card).toHaveAttribute('data-flipped', 'true');
  await expect(page.getByTestId('btn-wrong')).toBeVisible();
  await page.getByTestId('btn-wrong').click();
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('flashcard')).toHaveAttribute('data-flipped', 'false');
    await page.getByTestId('flashcard').click();
    await page.getByTestId('btn-right').click();
  }
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('sum-correct')).toHaveText('2');
  await expect(page.getByTestId('sum-incorrect')).toHaveText('1');

  await page.goto('/#/statistik');
  await expect(page.getByText('Lernaktivität pro Tag')).toBeVisible();
  await expect(page.locator('text=Wiederholungen').first()).toBeVisible();

  await page.goto('/#/problemvokabeln');
  await expect(page.getByText('Noch zu wenig Daten')).toBeVisible();
});

test('download a backup and restore it after data loss', async ({ page }) => {
  await addWord(page, 'کتاب', 'Buch');
  await page.goto('/#/einstellungen');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('create-backup').click()]);
  const path = await download.path();
  const backup = JSON.parse(readFileSync(path!, 'utf8'));
  expect(backup.format).toBe('persisch-karten-backup');
  expect(backup.data.vocab[0].persian).toBe('کتاب');

  // Simulate data loss
  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.deleteDatabase('persisch-karten'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  await page.reload();
  await page.goto('/#/vokabeln');
  await expect(page.getByText('Noch keine Vokabeln')).toBeVisible();

  await page.goto('/#/einstellungen');
  await page.getByTestId('restore-input').setInputFiles(path!);
  await expect(page.getByTestId('restore-summary')).toContainText('1 Vokabeln');
  await page.getByRole('button', { name: 'Zusammenführen' }).click();
  await page.goto('/#/vokabeln');
  await expect(page.getByTestId('vocab-count')).toHaveText('1 Vokabel');

  // An invalid file is rejected
  await page.goto('/#/einstellungen');
  await page.getByTestId('restore-input').setInputFiles({ name: 'kaputt.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
  await expect(page.getByText('Sicherung nicht lesbar')).toBeVisible();
});

test('works offline after the first load (service worker)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await addWord(page, 'آب', 'Wasser');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true));
  await page.reload(); // the page is now controlled by the service worker
  await context.setOffline(true);
  await page.goto('/#/');
  await page.reload();
  await expect(page.getByTestId('start-learning')).toBeVisible();
  await page.getByTestId('start-learning').click();
  await page.getByTestId('flashcard').click();
  await page.getByTestId('btn-right').click();
  await expect(page.getByTestId('summary')).toBeVisible();
  await page.goto('/#/statistik');
  await expect(page.getByText('Lernaktivität pro Tag')).toBeVisible();
  await context.setOffline(false);
});

test('load and remove sample data; layout never overflows horizontally', async ({ page }) => {
  await page.goto('/#/einstellungen');
  await page.getByTestId('load-sample').click();
  await page.goto('/#/vokabeln');
  await expect(page.getByTestId('vocab-count')).toHaveText('20 Vokabeln');
  for (const route of ['/', '/#/lernen', '/#/vokabeln', '/#/lektionen', '/#/statistik', '/#/einstellungen']) {
    await page.goto(route);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal scrolling on ${route}`).toBeLessThanOrEqual(0);
  }
  await page.goto('/#/einstellungen');
  await page.getByTestId('remove-sample').click();
  await page.getByRole('button', { name: 'Beispieldaten entfernen' }).last().click();
  await page.goto('/#/vokabeln');
  await expect(page.getByText('Noch keine Vokabeln')).toBeVisible();
});
