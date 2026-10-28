import { expect, test } from '@playwright/test';
import { countAttempts, getReading, resetAndSeedReady, withTestDb } from '../helpers/test-db';

test.beforeEach(async () => { await resetAndSeedReady(); });

test('manual /complete URL manipulation is redirected to the server-authoritative stage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bắt đầu nghiên cứu' }).click();
  await page.goto('/complete');
  await expect(page).toHaveURL(/\/information$/);
});

test('refresh during reading does not reset reading_started_at', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Bắt đầu nghiên cứu' }).click(); await page.getByRole('button', { name: 'Tiếp tục đến phần đồng ý' }).click(); await page.getByRole('button', { name: 'Tôi đồng ý' }).click(); await page.getByRole('button', { name: 'Tiếp tục' }).click();
  const id = (await page.context().cookies()).find(c=>c.name==='exp_session')!.value;
  await page.waitForTimeout(200);
  const first = await getReading(id,1); await page.reload(); await page.waitForTimeout(200); const second = await getReading(id,1);
  expect(first?.startedAt?.toISOString()).toBe(second?.startedAt?.toISOString());
});

test('participant may withdraw without giving a reason', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Bắt đầu nghiên cứu' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Rút khỏi nghiên cứu' }).click();
  await expect(page).toHaveURL(/\/withdraw$/);
});



test('public landing page does not expose an admin navigation link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /admin/i })).toHaveCount(0);
});

test('participant cannot skip the pre-question review stage by typing the test URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bắt đầu nghiên cứu' }).click();
  await page.getByRole('button', { name: 'Tiếp tục đến phần đồng ý' }).click();
  await page.getByRole('button', { name: 'Tôi đồng ý' }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Hoàn tất lượt đọc' }).click();
  await expect(page).toHaveURL(/\/experiment\/review$/);
  await page.goto('/experiment/test');
  await expect(page).toHaveURL(/\/experiment\/review$/);
});

test('admin API is not accessible without authorization', async ({ request }) => {
  const response = await request.get('/api/admin/sessions');
  expect(response.status()).toBe(401);
});

test('unanswered MCQs can be submitted and remain null', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Bắt đầu nghiên cứu' }).click(); await page.getByRole('button', { name: 'Tiếp tục đến phần đồng ý' }).click(); await page.getByRole('button', { name: 'Tôi đồng ý' }).click(); await page.getByRole('button', { name: 'Tiếp tục' }).click(); await page.waitForTimeout(1100); await page.getByRole('button', { name: 'Hoàn tất lượt đọc' }).click(); await page.getByRole('button', { name: 'Bắt đầu trả lời' }).click();
  const id = (await page.context().cookies()).find(c=>c.name==='exp_session')!.value;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Nộp câu trả lời' }).click();
  await expect(page).toHaveURL(/\/experiment\/break$/);
  const attempt = await withTestDb(db=>db.collection('test_attempts').findOne({sessionId:id,roundNo:1}));
  expect(attempt?.answers.every((a: {selectedOptionId:null})=>a.selectedOptionId===null)).toBe(true);
  expect(await countAttempts(id,1)).toBe(1);
});
