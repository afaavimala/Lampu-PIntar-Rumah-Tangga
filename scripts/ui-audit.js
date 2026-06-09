const { chromium } = require('playwright');
const fs = require('fs');

const URL = 'https://lampupintar.afaavimala.workers.dev/';
const EMAIL = process.env.BACKEND_SEED_ADMIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.BACKEND_SEED_ADMIN_PASSWORD || 'admin12345';

async function findAndFillLogin(page) {
  // Heuristic: find email and password inputs
  const inputs = await page.$$('input');
  let emailInput = null;
  let passwordInput = null;
  for (const input of inputs) {
    const type = (await input.getAttribute('type')) || '';
    const name = (await input.getAttribute('name')) || '';
    const placeholder = (await input.getAttribute('placeholder')) || '';
    const id = (await input.getAttribute('id')) || '';
    const attr = [type, name, placeholder, id].join(' ').toLowerCase();
    if (!emailInput && (attr.includes('email') || type === 'email' || attr.includes('username') || attr.includes('e-mail'))) {
      emailInput = input;
    }
    if (!passwordInput && (type === 'password' || attr.includes('password') || name.toLowerCase().includes('password'))) {
      passwordInput = input;
    }
  }
  // Fallback: first two inputs
  if (!emailInput && inputs.length >= 1) emailInput = inputs[0];
  if (!passwordInput && inputs.length >= 2) passwordInput = inputs[1];

  if (!emailInput || !passwordInput) {
    throw new Error('Could not locate login inputs');
  }

  await emailInput.fill(EMAIL);
  await passwordInput.fill(PASSWORD);

  // Try to find a submit button
  const btnTexts = ['login', 'masuk', 'sign in', 'submit'];
  for (const t of btnTexts) {
    const btn = await page.$(`text=/\\b${t}\\b/i`);
    if (btn) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 8000 }).catch(()=>{}), btn.click().catch(()=>{})]);
      return;
    }
  }
  // Try generic submit
  const submit = await page.$('button[type=submit],input[type=submit]');
  if (submit) await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 8000 }).catch(()=>{}), submit.click().catch(()=>{})]);
}

async function clickScheduleDelete(page, outDir) {
  // Try to navigate to schedule page via link text
  const linkTexts = ['schedule', 'schedules', 'penjadwalan', 'jadwal'];
  for (const t of linkTexts) {
    const link = await page.$(`text=/\\b${t}\\b/i`);
    if (link) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 8000 }).catch(()=>{}), link.click().catch(()=>{})]);
      break;
    }
  }
  // Find delete buttons on page
  const delTexts = ['delete', 'hapus', 'remove', 'delete schedule'];
  for (const t of delTexts) {
    const buttons = await page.$$(`text=/\\b${t}\\b/i`);
    if (buttons && buttons.length) {
      // Click first one
      try {
        // handle potential dialog
        page.once('dialog', async dialog => { await dialog.accept().catch(()=>{}); });
        await buttons[0].click();
        await page.waitForTimeout(1500);
        const shot = `${outDir}/after-delete-${t.replace(/\\s+/g,'_')}.png`;
        await page.screenshot({ path: shot, fullPage: true });
        return true;
      } catch (e) {
        // continue
      }
    }
  }
  return false;
}

async function run() {
  const outDir = 'scripts/ui-audit-output';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push('PAGEERROR: ' + err.message);
  });

  page.on('requestfailed', request => {
    consoleErrors.push(`REQUESTFAILED: ${request.url()} ${request.failure()?.errorText || ''}`);
  });

  page.on('response', async response => {
    try {
      const status = response.status();
      if (status >= 400) {
        let body = '';
        try { body = await response.text(); } catch (e) { body = '<unable to read response body>'; }
        consoleErrors.push(`HTTP ${status} ${response.url()} ${body}`);
      }
    } catch (e) {
      // ignore
    }
  });

  console.log('Navigating to', URL);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 }).catch(()=>{});
  await page.screenshot({ path: `${outDir}/landing.png`, fullPage: true });

  let loggedIn = false;
  try {
    await findAndFillLogin(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${outDir}/after-login.png`, fullPage: true });
    loggedIn = true;
  } catch (e) {
    console.warn('Login attempt failed:', e.message);
  }

  // After login or if already logged in, visit dashboard root and test buttons
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 10000 }).catch(()=>{});

  // Capture console logs before interactions
  await page.screenshot({ path: `${outDir}/dashboard-before.png`, fullPage: true });

  const deleted = await clickScheduleDelete(page, outDir);
  if (!deleted) console.warn('No delete button detected on schedules page');

  await page.screenshot({ path: `${outDir}/final.png`, fullPage: true });

  await browser.close();

  fs.writeFileSync(`${outDir}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
  if (consoleErrors.length) {
    console.error('Console errors detected:', consoleErrors.length);
    process.exit(2);
  }
  console.log('Audit completed, no console errors detected. Output in', outDir);
}

run().catch(err => { console.error(err); process.exit(3); });
