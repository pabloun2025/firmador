// Browser regression tests: every external request is intercepted. No real users,
// emails, PDF storage, credentials, or production mutations are involved.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only a local test server is allowed');
const output = process.env.UI_OUTPUT || '/tmp/leapsign-ui-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const failures = [];
let assertions = 0;
async function check(name, action) {
  try { await action(); assertions++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
async function accessibility(page, name) {
  if (!process.env.AXE_CORE_PATH) return;
  await page.addScriptTag({ path: process.env.AXE_CORE_PATH });
  const violations = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
  })).violations.map(({ id, nodes }) => ({ id, elements: nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })));
  writeFileSync(`${output}/accessibility-${name.replaceAll(' ', '-')}.json`, JSON.stringify(violations, null, 2));
  await check(`accessibility ${name}`, async () => assert.deepEqual(violations, []));
}
async function isolatedContext(width, authenticated = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.pathname.includes('/rest/v1/')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 400, json: { error: 'External requests blocked by test harness' } });
  });
  if (authenticated) await context.addInitScript(() => {
    const base64url = value => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const jwt = `${base64url({ alg: 'none' })}.${base64url({ sub: '11111111-1111-4111-8111-111111111111', exp: 4102444800, aal: 'aal2' })}.c3ludGhldGlj`;
    localStorage.setItem('sb-lgsdoutarthfymbjgdrj-auth-token', JSON.stringify({ access_token: jwt, refresh_token: 'synthetic-test-only', token_type: 'bearer', expires_at: 4102444800, expires_in: 3600, user: { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.test', user_metadata: {}, aud: 'authenticated' } }));
  });
  return context;
}
const workflowId = '22222222-2222-4222-8222-222222222222';
function mockProcess(context) {
  const state = { created: false, signatures: 0, status: 'active', waiting: false, denySubmit: false, failTracking: false, sent: 0, downloads: 0, actions: [] };
  const contacts = Array.from({ length: 12 }, (_, index) => ({ id: `contact-${index}`, display_name: `Persona ${String(index + 1).padStart(2, '0')}`, email: `persona${index + 1}@example.test` }));
  const workflow = () => ({ id: workflowId, title: 'Contrato de prueba', status: state.status, signature_count: state.signatures, expected_signature_count: 2, created_at: '2026-10-19T08:00:00Z', current_version_id: `version-${state.signatures}`, message: '' });
  const inventory = () => state.signatures ? {
    signatureInventories:[{version_id:`version-${state.signatures}`,signature_count:3,inherited_count:2,added_signature_id:'c'.repeat(64),policy:'leapsign-v1.1-integrity-offline-1'}],
    pdfSignatures:[{version_id:`version-${state.signatures}`,signature_id:'c'.repeat(64),record:{field:'Signature_3',declaredSigningTime:null,certificate:{subject:'Titular sintético con nombre largo para comprobar la presentación en pantallas pequeñas',issuer:'Entidad sintética de pruebas'},algorithms:{digest:'sha256',signature:'ecdsa'},integrity:'valid',trust:'not_evaluated',revocation:'unknown',certificateValidity:'expired'}}],
  } : {signatureInventories:[],pdfSignatures:[]};
  const setup = async () => {
    await context.route('**/rest/v1/**', route => route.fulfill({ json: route.request().url().includes('owner_contacts') ? contacts : state.created ? [workflow()] : [] }));
    await context.route('**/functions/v1/**', async route => {
      const slug = new URL(route.request().url()).pathname.split('/').at(-1);
      let payload = {};
      try { payload = route.request().postDataJSON(); } catch { /* multipart PDF upload */ }
      if (slug === 'create-round') { state.created = true; return route.fulfill({ json: { id: workflowId } }); }
      if (slug === 'send-round-invitations') { state.sent += payload.recipients.length; return route.fulfill({ json: { sent: payload.recipients.length, skipped: 0, completed: 0, failed: [], remaining: 2 - state.sent } }); }
      if (slug === 'get-owner-round') {
        if (state.failTracking) return route.fulfill({ status: 503, json: { error: 'Synthetic database unavailable' } });
        return route.fulfill({ json: { workflow: workflow(), activeTurn: null, queue: [], reports: [], events: [], submissions: [], contacts, invitations: [],...inventory(), versions: [{ id: `version-${state.signatures}`, sequence: state.signatures, sha256:'a'.repeat(64), byte_size: 700, created_at: '2026-10-19T08:00:00Z', submitted_by_name: 'Ana Prueba', submitted_by_email: 'ana@example.test', validation_status: 'accepted' }] } });
      }
      if (slug === 'owner-round-action') { state.actions.push(payload.action); if (payload.action === 'finalize') state.status = 'completed'; return route.fulfill({ json: { ok: true } }); }
      if (slug === 'owner-download-version') return route.fulfill({ json: { url: 'https://files.example.test/final.pdf' } });
      if (slug === 'owner-final-share') return state.status === 'completed'
        ? route.fulfill({json:{token:'a'.repeat(43),title:'Contrato de prueba',expiresAt:new Date(Date.now()+5*86400000).toISOString()}})
        : route.fulfill({status:404,json:{error:'Not final'}});
      if (slug === 'download-final-share') {
        if(state.status!=='completed'||state.expiredFinal||payload.token!=='a'.repeat(43))return route.fulfill({status:404,json:{error:'Enlace no disponible'}});
        return route.fulfill({json:payload.action==='download'?{url:'https://files.example.test/final.pdf'}:{title:'Contrato de prueba',expiresAt:new Date(Date.now()+5*86400000).toISOString()}});
      }
      if (slug === 'get-round') return route.fulfill({ json: { title: 'Contrato de prueba', message: '', needsKey: false } });
      if (slug === 'take-open-turn') return route.fulfill({ json: state.waiting ? { state: 'waiting', position: 3 } : { state: 'active', expires_at: new Date(Date.now() + 600000).toISOString(), holder_name: 'Beatriz Prueba', email: 'bea@example.test' } });
      if (slug === 'participant-download-version') { state.downloads++; return route.fulfill({ json: { url: 'https://files.example.test/Contrato.pdf', expectedFilename: 'Contrato de prueba.pdf', parentByteSize: 500 } }); }
      if (slug === 'release-open-turn') return route.fulfill({ json: { ok: true } });
      if (slug === 'submit-signed-version') {
        if (state.denySubmit) return route.fulfill({ status: 400, json: { error: 'Tu turno ya no está activo.' } });
        state.signatures++; return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ status: 400, json: { error: `Unconfigured synthetic route: ${slug}` } });
    });
  };
  return { state, setup };
}
try {
  for (const width of (process.env.UI_WIDTHS || '1440,768,390').split(',').map(Number)) {
    const context = await isolatedContext(width, true);
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(`Browser ${width}: ${error.message}`));
    await page.goto(base);
    await page.getByRole('heading', { name: 'Documentos para firmar' }).waitFor();
    await page.getByRole('button', { name: 'Crear proceso y obtener enlace' }).click();
    await check(`creation error beside action (${width})`, async () => {
      const button = await page.getByRole('button', { name: 'Crear proceso y obtener enlace' }).boundingBox();
      const notice = await page.getByRole('alert').boundingBox();
      assert(notice && button && notice.y >= button.y + button.height && notice.y - button.y - button.height < 40);
    });
    await check(`no horizontal overflow (${width})`, async () => {
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    });
    if (width === 390) await check('mobile inputs avoid browser zoom', async () => {
      const size = await page.getByLabel('Nombre del documento').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert(size >= 16, `Input font is ${size}px`);
    });
    await page.screenshot({ path: `${output}/workspace-${width}.png`, fullPage: true });
    await accessibility(page, `workspace ${width}`);
    await context.close();

    const authContext = await isolatedContext(width);
    const authPage = await authContext.newPage();
    const images = [];
    authPage.on('request', request => { if (request.url().endsWith('/leapsign-secure-flow.png')) images.push(request.url()); });
    authPage.on('pageerror', error => failures.push(`Auth ${width}: ${error.message}`));
    await authPage.goto(base);
    await authPage.getByRole('heading', { name: 'Accede a LeapSign' }).waitFor();
    await authPage.screenshot({ path: `${output}/login-${width}.png`, fullPage: true });
    await accessibility(authPage, `login ${width}`);
    await authPage.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
    await check(`password visibility toggle (${width})`, async () => {
      assert.equal(await authPage.getByLabel('Contraseña', { exact: true }).getAttribute('type'), 'text');
    });
    await authPage.getByRole('button', { name: 'Crear una cuenta', exact: true }).click();
    await authPage.getByRole('heading', { name: 'Crea tu cuenta' }).waitFor();
    await authPage.screenshot({ path: `${output}/register-${width}.png`, fullPage: true });
    await accessibility(authPage, `registration ${width}`);
    if (width === 390) await check('mobile does not download the desktop illustration', async () => assert.equal(images.length, 0));
    await authPage.goto(`${base}/superadmin`);
    await authPage.getByRole('heading', { name: 'Administración de LeapSign' }).waitFor();
    await authPage.screenshot({ path: `${output}/admin-${width}.png`, fullPage: true });
    await accessibility(authPage, `admin login ${width}`);
    await check(`admin has no horizontal overflow (${width})`, async () => assert(await authPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
    await authContext.close();

    const adminContext = await isolatedContext(width, true);
    const template = { template_key: 'invitation', label: 'Invitación de prueba', subject_template: 'Firma pendiente', body_template: 'Hola {{name}}', enabled: true, updated_at: '2026-10-19T08:00:00Z' };
    await adminContext.route('**/functions/v1/superadmin-console', route => {
      const { action } = route.request().postDataJSON();
      if (action === 'dashboard') return route.fulfill({ json: { metrics: { accounts_total: 2, workflows_active: 1, active_turns: 1, waiting_people: 1, document_versions: 2, stored_bytes: 1000, invitations_failed: 0, cleanup_failed: 0, cleanup_pending: 0, errors_last_24h: 0 }, settings: { email_master_enabled: true, email_invitations_enabled: true, email_reminders_enabled: true, email_completion_enabled: true, automatic_cleanup_enabled: true, maintenance_mode: false }, templates: [template], audit: [] } });
      if (action === 'users') return route.fulfill({ json: { users: [{ id: 'user-test', name: 'Ana Prueba', email: 'ana@example.test', created_at: '2026-10-19T08:00:00Z', confirmed_at: '2026-10-19T08:00:00Z', workflows: { total: 1, active: 1 } }] } });
      if (action === 'workflows') return route.fulfill({ json: { workflows: [{ id: workflowId, title: 'Contrato de prueba', owner_email: 'ana@example.test', status: 'active', signature_count: 1, created_at: '2026-10-19T08:00:00Z', last_activity_at: '2026-10-19T08:00:00Z' }] } });
      return route.fulfill({ status: 503, json: { error: 'No se pudo guardar la plantilla de prueba.' } });
    });
    const admin = await adminContext.newPage();
    admin.on('pageerror', error => failures.push(`Admin ${width}: ${error.message}`));
    await admin.goto(`${base}/superadmin`);
    await admin.getByRole('heading', { name: 'Resumen operativo' }).waitFor().catch(async error => {
      await admin.screenshot({ path: `${output}/admin-setup-error-${width}.png`, fullPage: true });
      console.error(JSON.stringify({ browserErrors: failures, body: await admin.locator('body').innerText() }));
      throw error;
    });
    for (const [tab, heading] of [['Resumen', 'Resumen operativo'], ['Cuentas', 'Cuentas'], ['Procesos', 'Procesos y flujos'], ['Correos y sistema', 'Correos, plantillas y servicio'], ['Auditoría', 'Auditoría administrativa']]) {
      await admin.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
      await admin.getByRole('heading', { name: heading, exact: true }).waitFor();
      await check(`admin ${tab} stays within viewport (${width})`, async () => assert(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
      await accessibility(admin, `admin-${tab} ${width}`);
      await admin.screenshot({ path: `${output}/admin-${tab}-${width}.png`, fullPage: true });
    }
    await admin.getByRole('navigation').getByRole('button', { name: 'Correos y sistema', exact: true }).click();
    await admin.getByRole('button', { name: 'Editar', exact: true }).click();
    const modal = admin.getByRole('dialog');
    await check(`template dialog receives keyboard focus (${width})`, async () => assert.equal(await modal.evaluate(el => el.contains(document.activeElement)), true));
    await modal.getByLabel('Asunto', { exact: true }).fill('Asunto modificado de prueba');
    admin.on('dialog', dialog => dialog.accept('Prueba de error controlado'));
    await admin.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
    await admin.getByText('No se pudo guardar la plantilla de prueba.', { exact: true }).waitFor();
    await check(`failed template save keeps the editor and text (${width})`, async () => {
      await modal.getByRole('alert').waitFor();
      assert.equal(await modal.getByLabel('Asunto', { exact: true }).inputValue(), 'Asunto modificado de prueba');
    });
    await check(`template dialog supports Escape and restores focus (${width})`, async () => {
      await admin.keyboard.press('Escape');
      assert.equal(await modal.count(), 0);
      assert.equal(await admin.getByRole('button', { name: 'Editar', exact: true }).evaluate(el => el === document.activeElement), true);
    });
    await adminContext.close();

    const flowContext = await isolatedContext(width, true);
    const { state, setup } = mockProcess(flowContext);
    await setup();
    const flow = await flowContext.newPage();
    flow.on('pageerror', error => failures.push(`Flow ${width}: ${error.message}`));
    await flow.goto(base);
    await flow.getByLabel('Nombre del documento').fill('Contrato de prueba');
    await flow.locator('input[type=file]').setInputFiles({ name: 'Contrato de prueba.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic test fixture only') });
    await flow.getByRole('button', { name: 'Crear proceso y obtener enlace' }).click();
    const created = flow.getByRole('region', { name: 'Proceso creado' });
    await created.waitFor();
    await check(`creation moves focus to the next stage (${width})`, async () => assert.equal(await created.evaluate(el => el === document.activeElement), true));
    await check(`visible signing link and WhatsApp action (${width})`, async () => {
      assert(await created.locator('a[href*="/r/"]').count() > 0);
      assert.match(await created.getByRole('link', { name: /Compartir.*WhatsApp/ }).getAttribute('href'), /wa\.me/);
    });
    await check(`contact pagination and selection (${width})`, async () => {
      assert.equal(await flow.locator('.contact-row').count(), 10);
      await flow.getByRole('button', { name: 'Siguiente', exact: true }).click();
      assert.equal(await flow.locator('.contact-row').count(), 2);
      await flow.getByRole('button', { name: 'Anterior', exact: true }).click();
    });
    await check(`contact emails remain readable without forced capitals (${width})`, async () => {
      const style = await flow.locator('.contact-row small').first().evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), transform: getComputedStyle(el).textTransform }));
      assert(style.size >= 12 && style.transform === 'none');
    });
    await flow.screenshot({ path: `${output}/share-${width}.png`, fullPage: true });
    await accessibility(flow, `share ${width}`);
    state.failTracking = true;
    await flow.getByPlaceholder('persona@ejemplo.com').fill('bea@example.test');
    await flow.getByRole('button', { name: 'Enviar 1 invitación', exact: true }).click();
    await flow.getByRole('heading', { name: 'Seguimiento', exact: true }).waitFor();
    await flow.getByRole('alert').filter({ hasText: 'No pudimos' }).waitFor();
    state.failTracking = false;
    await flow.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await check(`tracking can recover from its first failed load (${width})`, async () => {
      await flow.locator('.owner-detail').waitFor({ timeout: 2000 });
    });
    if (!await flow.locator('.owner-detail').count()) throw new Error('Initial tracking recovery failed');
    await check(`invitation handoff to tracking (${width})`, async () => assert.equal(state.sent, 1));
    await check(`tracking status does not overlap its heading (${width})`, async () => {
      const gap = await flow.evaluate(() => document.querySelector('.auto-refresh-note').getBoundingClientRect().top - document.querySelector('.owner-panel-head').getBoundingClientRect().bottom);
      assert(gap >= 4, `Header/status gap is ${gap}px`);
    });
    await flow.screenshot({ path: `${output}/tracking-${width}.png`, fullPage: true });
    await accessibility(flow, `tracking ${width}`);
    state.failTracking = true;
    await flow.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await check(`tracking failure remains visible and preserves document (${width})`, async () => {
      await flow.getByRole('alert').filter({ hasText: 'No pudimos actualizar' }).waitFor();
      assert(await flow.locator('.owner-detail').getByRole('heading', { name: 'Contrato de prueba', exact: true }).count() > 0);
    });
    state.failTracking = false;
    await flow.getByRole('button', { name: 'Actualizar', exact: true }).click();
    const finalButton = flow.getByRole('button', { name: 'Aceptar PDF final y cerrar firmas', exact: true });
    await check(`current PDF precedes participants and has one download (${width})`, async () => {
      assert.equal(await flow.getByRole('button', { name: 'Descargar PDF actual', exact: true }).count(), 1);
      assert(await flow.locator('.version-section').evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector('.signature-queue')) & Node.DOCUMENT_POSITION_FOLLOWING)));
      assert.equal(await flow.locator('.process-controls').getAttribute('open'), null);
      assert.equal(await flow.getByLabel('He revisado el PDF').isDisabled(), true);
      assert(await flow.getByText('Faltan 2 firmas previstas.', { exact: false }).isVisible());
    });
    await check(`final confirmation required (${width})`, async () => assert.equal(await finalButton.isDisabled(), true));
    await flow.getByRole('button', { name: 'Descargar PDF actual', exact: true }).click();
    await flow.getByLabel('He revisado el PDF').check();
    state.signatures = 1;
    await flow.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await check(`new PDF requires a new review (${width})`, async () => {
      await flow.getByText('1 de 2 firmas recibidas', { exact: true }).waitFor();
      assert.equal(await flow.getByLabel('He revisado el PDF').isChecked(), false);
      assert.equal(await flow.getByLabel('He revisado el PDF').isDisabled(), true);
      assert.equal(await finalButton.isDisabled(), true);
    });
    await flow.locator('.signature-queue > summary').click();
    state.signatures = 2;
    await flow.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await check(`goal reached guides review without auto-closing (${width})`, async () => {
      await flow.getByText('Todas las firmas previstas se han recibido', { exact: true }).waitFor();
      assert.equal(state.status, 'active');
      assert.equal(await flow.locator('.signature-queue').getAttribute('open'), '');
      assert.equal(await flow.locator('.owner-detail').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    });
    await flow.screenshot({ path: `${output}/tracking-review-${width}.png`, fullPage: true });
    await check(`detected names fit the viewport without implying validity (${width})`,async()=>{
      const section=flow.getByRole('region',{name:'Firmas digitales de esta versión'});
      await section.getByText('3 firmas detectadas',{exact:true}).waitFor();
      await section.getByText('Ver detalles de las firmas',{exact:true}).click();
      assert(await section.getByText('Nombre en la firma:',{exact:false}).isVisible());
      assert.equal(await section.getByText('Integridad verificada',{exact:false}).count(),0);
      assert(await flow.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await accessibility(flow,`signature-inventory ${width}`);
      await flow.screenshot({path:`${output}/signature-inventory-${width}.png`,fullPage:true});
    });
    await flow.getByRole('button', { name: 'Descargar PDF actual', exact: true }).click();
    await flow.getByLabel('He revisado el PDF').check();
    flow.on('dialog', dialog => dialog.accept());
    await finalButton.click();
    await check(`owner can confirm the final version (${width})`, async () => {
      await flow.getByText('Finalizado', { exact: true }).first().waitFor();
      assert.deepEqual(state.actions, ['finalize']);
    });
    const finalShare=flow.getByRole('region',{name:'Compartir documento finalizado'});
    await finalShare.getByRole('link',{name:'WhatsApp',exact:true}).waitFor();
    const finalUrl=await finalShare.locator('.final-share-url').getAttribute('href');
    await check(`final link, WhatsApp and email contain the same final URL (${width})`,async()=>{
      assert(finalUrl.includes('/f/')&&new URL(finalUrl).hash.length===44);
      assert(new URL(await finalShare.getByRole('link',{name:'WhatsApp',exact:true}).getAttribute('href')).searchParams.get('text').includes(finalUrl));
      const mail=new URL(await finalShare.getByRole('link',{name:'Compartir por correo'}).getAttribute('href'));
      assert.equal(mail.protocol,'mailto:');assert(mail.searchParams.get('body').includes(finalUrl));
      assert(mail.searchParams.get('body').includes('No es una invitación'));
    });
    await finalShare.scrollIntoViewIfNeeded();
    await flow.screenshot({path:`${output}/final-share-${width}.png`,fullPage:true});
    await accessibility(flow,`final share ${width}`);
    const receiverContext=await isolatedContext(width),receiverFixture=mockProcess(receiverContext);
    receiverFixture.state.status='completed';await receiverFixture.setup();
    await receiverContext.route('https://files.example.test/final.pdf',r=>r.fulfill({contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="Contrato_final.pdf"'},body:Buffer.from('%PDF-1.4 synthetic-only')}));
    const receiver=await receiverContext.newPage();
    await receiver.goto(finalUrl);
    await receiver.getByRole('button',{name:'Descargar PDF final',exact:true}).waitFor();
    await check(`final receiver needs no login or signing turn (${width})`,async()=>{
      assert.equal(await receiver.getByLabel('Correo',{exact:true}).count(),0);
      assert.equal(await receiver.getByRole('button',{name:'Solicitar turno para firmar',exact:true}).count(),0);
      const download=receiver.waitForEvent('download');await receiver.getByRole('button',{name:'Descargar PDF final',exact:true}).click();await download;
    });
    await receiver.screenshot({path:`${output}/final-receiver-${width}.png`,fullPage:true});
    await accessibility(receiver,`final receiver ${width}`);
    receiverFixture.state.expiredFinal=true;await receiver.reload();
    await check(`expired final links show no download (${width})`,async()=>{
      await receiver.getByRole('heading',{name:'Este enlace ya no está disponible'}).waitFor();
      assert.equal(await receiver.getByRole('button',{name:'Descargar PDF final',exact:true}).count(),0);
    });
    await receiverContext.close();
    await flowContext.close();

    const signerContext = await isolatedContext(width);
    const signerMock = mockProcess(signerContext);
    await signerMock.setup();
    const signer = await signerContext.newPage();
    signer.on('pageerror', error => failures.push(`Signer ${width}: ${error.message}`));
    await signer.goto(`${base}/r/${workflowId}?invite=synthetic-test-token`);
    await signer.getByRole('heading', { name: 'Firma el documento en tres pasos' }).waitFor();
    await check(`upload requires a download (${width})`, async () => assert.equal(await signer.locator('input[type=file]').isDisabled(), true));
    await signer.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
    await check(`download enables signed PDF selection (${width})`, async () => {
      await signer.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
      assert.equal(await signer.locator('input[type=file]').isDisabled(), false);
    });
    await signer.locator('input[type=file]').setInputFiles({ name: 'otro-documento.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(600) });
    await check(`externally renamed PDFs can be selected (${width})`, async () => {
      await signer.getByLabel('He revisado el documento').check();
      assert.equal(await signer.getByRole('button', { name: 'Subir PDF firmado y completar mi turno' }).isDisabled(), false);
      assert.equal(await signer.getByRole('alert').filter({hasText:'nombre original'}).count(),0);
    });
    await signer.locator('input[type=file]').setInputFiles({ name: 'Contrato de prueba signed.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(600) });
    await signer.getByLabel('He revisado el documento').check();
    await signer.getByRole('button', { name: 'Liberar turno sin firmar', exact: true }).click();
    await signer.getByRole('button', { name: 'Solicitar turno para firmar', exact: true }).click();
    await signer.getByRole('heading', { name: 'Firma el documento en tres pasos' }).waitFor();
    await check(`a new turn requires a fresh download and review (${width})`, async () => {
      assert.equal(await signer.locator('input[type=file]').isDisabled(), true);
      assert.equal(await signer.getByLabel('He revisado el documento').isChecked(), false);
    });
    await signer.getByRole('button', { name: /^Descargar (PDF|de nuevo)$/ }).click();
    await signer.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
    await signer.locator('input[type=file]').setInputFiles({ name: 'Contrato de prueba signed.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(600) });
    await signer.getByLabel('He revisado el documento').check();
    signerMock.state.denySubmit = true;
    await signer.getByRole('button', { name: 'Subir PDF firmado y completar mi turno' }).click();
    await check(`server rejection does not falsely complete a signature (${width})`, async () => {
      await signer.getByRole('alert').filter({ hasText: 'turno ya no está activo' }).waitFor();
      assert.equal(await signer.getByRole('heading', { name: 'Tu firma ya forma parte del documento' }).count(), 0);
    });
    await signer.screenshot({ path: `${output}/signer-${width}.png`, fullPage: true });
    await accessibility(signer, `signer ${width}`);
    signerMock.state.denySubmit = false;
    await signer.getByRole('button', { name: 'Subir PDF firmado y completar mi turno' }).click();
    await signer.getByRole('heading', { name: 'Tu firma ya forma parte del documento' }).waitFor();
    await check(`successful submission completes the signer screen (${width})`, async () => assert.equal(signerMock.state.signatures, 1));
    signerMock.state.waiting = true;
    await signer.goto(`${base}/r/${workflowId}?invite=synthetic-second-test-token`);
    await signer.getByRole('heading', { name: 'Estás en la cola', exact: true }).waitFor();
    await signer.screenshot({ path: `${output}/queue-${width}.png`, fullPage: true });
    await accessibility(signer, `queue ${width}`);
    await check(`queue and game remain visible (${width})`, async () => {
      assert.equal(await signer.locator('.waiting-position').textContent(), '2');
      assert.equal(await signer.getByRole('button', { name: 'Empezar', exact: true }).isVisible(), true);
    });
    await check(`waiting screen does not repeat the entry form (${width})`, async () => assert.equal(await signer.getByPlaceholder('Como quieres aparecer').count(), 0));
    await signerContext.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ assertions, failures }));
if (failures.length) process.exitCode = 1;
