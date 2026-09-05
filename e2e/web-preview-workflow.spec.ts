import { expect, test } from '@playwright/test';

test('web preview completes Create → Chat → Flow → Backtest → Paper → Live safety review', async ({ page }) => {
  await page.goto('http://127.0.0.1:4176/web-preview.html');
  await expect(page.getByRole('heading', { name: 'Connect your AI provider' })).toBeVisible();

  await page.getByLabel('Profile name').fill('Preview Trader');
  await page.getByLabel('Base URL').fill('https://api.example.com/v1');
  await page.getByLabel('API key').fill('preview-only-key');
  await page.getByLabel('Model').fill('preview/model');
  await page.getByRole('button', { name: 'Connect & continue' }).click();

  await page.getByRole('button', { name: 'Create new bot' }).first().click();
  await page.getByLabel('Bot name').fill('BTC Flow Preview');
  await page.getByLabel('Market').fill('BTC-PERP');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: 'BTC Flow Preview' })).toBeVisible();

  await page.getByLabel('Message Catbots AI').fill('Use positive ETF flow and RSI below 30, then open a long position.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Draft v1 is valid.', { exact: false })).toBeVisible();
  await expect(page.locator('[aria-label^="trigger: Interval"]')).toBeVisible();
  await expect(page.getByText('schemaVersion')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Backtest' }).click();
  await page.getByRole('button', { name: 'Run backtest' }).click();
  await expect(page.getByText('Bundled sample data', { exact: true })).toBeVisible();
  await expect(page.getByText('+4.20%')).toBeVisible();
  await page.getByRole('button', { name: /preview-flow-v1/ }).click();
  await expect(page.getByText('all entry conditions passed')).toBeVisible();

  await page.getByRole('button', { name: 'Approve v1' }).click();
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Run Paper' }).click();
  await expect(page.getByText('Paper running', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Performance' }).click();
  await expect(page.getByText('$10,000.00')).toBeVisible();
  await page.getByRole('tab', { name: 'Logs' }).click();
  await expect(page.getByText('Waiting for the first trigger.')).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Paper deployment is stopped')).toBeVisible();

  await page.getByRole('button', { name: 'Review Live' }).click();
  await expect(page.getByRole('heading', { name: 'Review Live deployment' })).toBeVisible();
  await expect(page.getByText('Use an approved Agent/API Wallet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Live' })).toBeDisabled();
  await page.getByRole('link', { name: 'Open settings' }).first().click();

  await page.getByRole('switch', { name: /Enable Hyperliquid testnet/ }).click();
  await page.getByLabel('Master account address').fill('0x0123456789abcdef0123456789abcdef01234567');
  await page.getByLabel('Agent/API Wallet private key').fill(`0x${'a'.repeat(64)}`);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connection successful')).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.getByRole('button', { name: 'Bots' }).click();
  await page.getByRole('button', { name: 'Review Live' }).click();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await page.getByLabel('Type bot name to confirm').fill('BTC Flow Preview');
  await expect(page.getByRole('button', { name: 'Start Live' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start Live' }).click();
  await expect(page.getByText('Live · Hyperliquid testnet')).toBeVisible();
  await page.getByRole('button', { name: 'Stop Live' }).click();
});
