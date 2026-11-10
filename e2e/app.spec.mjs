import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TOTP } from 'otpauth';

test('player registration, selections, persisted prediction, wallet and rules',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.locator('#connection')).toContainText('Connected');
  await expect(page.locator('[data-audit]')).toHaveCount(0);
  await expect(page.locator('footer')).not.toContainText('experiment');
  await page.locator('#join-button').click();await page.locator('#name').fill('Playwright test');
  await page.locator('#email').fill(`e2e-${Date.now()}@example.test`);await page.locator('#password').fill('Long e2e unique password');await page.locator('#accepted').check();await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();await expect(page.locator('#balance')).toContainText('10,000');
  await expect(page.locator('#verification-notice')).toBeHidden();
  for(const room of [30,60,180,300]){await page.locator(`[data-room="${room}"]`).click();await expect(page.locator('#round-id')).toContainText(`Round ${room}-`)}
  for(const selection of ['GREEN','RED','VIOLET','0','1','2','3','4','5','6','7','8','9','SMALL','BIG']){await page.locator(`[data-choice="${selection}"]`).click();await expect(page.locator(`[data-choice="${selection}"]`)).toHaveAttribute('aria-pressed','true')}
  for(const base of [10,50,100,1000]){await page.locator(`[data-base="${base}"]`).click();await expect(page.locator('#base')).toHaveValue(String(base))}
  for(const multiplier of [1,5,10,20,50,100]){await page.locator(`[data-multiplier="${multiplier}"]`).click();await expect(page.locator(`[data-multiplier="${multiplier}"]`)).toHaveAttribute('aria-pressed','true')}
  await page.locator('[data-base="10"]').click();await page.locator('[data-multiplier="1"]').click();await page.locator('[data-choice="GREEN"]').click();
  await expect(page.locator('#place-button')).toHaveText('Place prediction',{timeout:10000});await page.locator('#place-button').click();await expect(page.locator('#bet-message')).toContainText('saved');await expect(page.locator('#balance')).toContainText('9,990');
  await page.locator('[data-choice="RED"]').click();await page.locator('#place-button').click();await expect(page.locator('#bet-message')).toContainText('Red and Green');await expect(page.locator('#balance')).toContainText('9,990');
  await page.locator('[data-history="bets"]').click();await expect(page.locator('#history-content')).toContainText('Green');
  await page.locator('#wallet-button').click();await expect(page.locator('#wallet-content')).toContainText('Welcome points');await page.getByRole('button',{name:'Close point activity'}).click();
  await page.getByRole('button',{name:'Rules & payouts',exact:true}).first().click();await expect(page.locator('#rules-dialog')).toContainText('lowest total payout');await page.keyboard.press('Escape');await expect(page.locator('#rules-dialog')).not.toBeVisible();
  await page.reload();await expect(page.locator('#balance')).toContainText('9,990');
  await page.locator('#account-button').click();await expect(page.locator('#join-button')).toBeVisible();expect(errors).toEqual([]);
});
test('responsive player board and admin sign-in have no horizontal overflow',async({page})=>{
  await page.goto('/');await expect(page.locator('#connection')).toContainText('Connected');
  for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
  await page.setViewportSize({width:1440,height:1200});await page.screenshot({path:'screenshots/professional-desktop.png',fullPage:false});
  await page.setViewportSize({width:375,height:1000});await page.screenshot({path:'screenshots/professional-mobile.png',fullPage:false});
  await page.goto('/admin');await expect(page.locator('#admin-access')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('admin authenticator, user details, block/unblock and all dashboard sections',async({page,browser})=>{
  const setup=readFileSync(process.env.E2E_ADMIN_SETUP || 'data/admin-setup.txt','utf8');
  const email=/Administrator email: (.+)/.exec(setup)[1],password=/Initial password: (.+)/.exec(setup)[1],secret=/Authenticator key: (.+)/.exec(setup)[1];
  const player=await browser.newContext();const userPage=await player.newPage();
  await userPage.goto('/');await userPage.locator('#join-button').click();await userPage.locator('#name').fill('Admin block test');const userEmail=`block-${Date.now()}@example.test`;await userPage.locator('#email').fill(userEmail);await userPage.locator('#password').fill('Unique block test password');await userPage.locator('#accepted').check();await userPage.locator('#auth-submit').click();await expect(userPage.locator('#auth-dialog')).not.toBeVisible();
  await page.goto('/admin');await page.locator('#admin-email').fill(email);await page.locator('#admin-password').fill(password);await page.locator('#admin-login button').click();await expect(page.locator('#admin-mfa')).toBeVisible();await page.locator('#mfa-code').fill(new TOTP({secret}).generate());await page.locator('#mfa-form button').click();await expect(page.locator('#admin-dashboard')).toBeVisible();
  await page.locator('#user-search').fill(userEmail);await page.locator('#search-form button').click();await expect(page.locator('[data-user]')).toHaveCount(1,{timeout:15000});await expect(page.locator('#admin-table')).toContainText(userEmail);await page.locator('[data-user]').click();await expect(page.locator('#user-details')).toContainText(userEmail);await page.locator('#close-user').click();
  await page.locator('[data-status]').click();await page.locator('#status-reason').fill('Automated account restriction check');await page.locator('#status-confirm').click();await expect(page.locator('#admin-table')).toContainText('Blocked');await userPage.reload();await expect(userPage.locator('#join-button')).toBeVisible();
  await page.locator('[data-status]').click();await page.locator('#status-reason').fill('Automated restriction check completed');await page.locator('#status-confirm').click();await expect(page.locator('[data-status]')).toHaveText('Block');
  for(const view of ['bets','rounds','events','users']){await page.locator(`[data-view="${view}"]`).click();await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed','true');await expect(page.locator('#admin-table')).not.toContainText('Loading')}
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'screenshots/admin-dashboard.png',fullPage:false});await player.close();
});
