import { expect, test, type Page } from '@playwright/test';
import { expireBreak, getSessionById, resetAndSeedReady } from '../helpers/test-db';

async function startThroughDemographics(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bắt đầu nghiên cứu' }).click();
  await expect(page).toHaveURL(/\/information$/);
  await page.getByRole('button', { name: 'Tiếp tục đến phần đồng ý' }).click();
  await page.getByRole('button', { name: 'Tôi đồng ý' }).click();
  await page.getByLabel('Nhóm tuổi').selectOption('21–24');
  await page.getByLabel('Ngành học').fill('Automated test fixture');
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page).toHaveURL(/\/experiment\/reading$/);
  const cookie = (await page.context().cookies()).find(c => c.name === 'exp_session');
  if (!cookie) throw new Error('Participant cookie missing.');
  return cookie.value;
}

async function completeReading(page: Page) {
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Hoàn tất lượt đọc' }).click();
  await expect(page).toHaveURL(/\/experiment\/review$/);
  await page.getByRole('button', { name: 'Bắt đầu trả lời' }).click();
  await expect(page).toHaveURL(/\/experiment\/test$/);
}

async function submitAllFirstOptions(page: Page) {
  const groups = page.locator('fieldset');
  await expect(groups).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) await groups.nth(i).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Nộp câu trả lời' }).click();
}

async function runFullFlow(page: Page, desiredGroup: 'A' | 'B') {
  await resetAndSeedReady({ existingGroup: desiredGroup === 'A' ? 'B' : 'A' });
  const id = await startThroughDemographics(page);
  expect((await getSessionById(id))?.groupCode).toBe(desiredGroup);
  await completeReading(page);
  await submitAllFirstOptions(page);
  await expect(page).toHaveURL(/\/experiment\/break$/);
  await expireBreak(id);
  await expect(page).toHaveURL(/\/experiment\/reading$/, { timeout: 5000 });
  await completeReading(page);
  await submitAllFirstOptions(page);
  await expect(page).toHaveURL(/\/complete$/);
  await expect(page.getByText('Cảm ơn bạn đã tham gia.')).toBeVisible();
}

test('Group A completes V1 → break → V2 flow', async ({ page }) => { await runFullFlow(page, 'A'); });
test('Group B completes V2 → break → V1 flow', async ({ page }) => { await runFullFlow(page, 'B'); });
