// Real browser + deterministic clock. All nonlocal requests are intercepted.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { newGame, stepGame, verifyGame } from '../supabase/functions/_shared/queue-game.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.UI_OUTPUT || '/tmp/arcade-ui'; mkdirSync(output,{recursive:true});
const browser = await chromium.launch({ executablePath:'/usr/bin/chromium',args:['--no-sandbox'] });
const id = '22222222-2222-4222-8222-222222222222';
try {
  for (const width of [1440,768,390]) {
    const context = await browser.newContext({ viewport:{width,height:950},reducedMotion:'reduce' });
    let offline = false, submissions = 0;
    let records = [{id:'a',alias:'Rana del río',score:4},{id:'b',alias:'SaltaPDF',score:2},{id:'c',alias:'Pablo',score:1}];
    await context.addInitScript(() => {
      let id=0; const callbacks=new Map();
      window.requestAnimationFrame = cb => {callbacks.set(++id,cb);return id;};
      window.cancelAnimationFrame = id => callbacks.delete(id);
      window.__arcadeFrame = time => {const pending=[...callbacks.values()];callbacks.clear();pending.forEach(cb=>cb(time));};
    });
    await context.route('**/*',async route => {
      const url=new URL(route.request().url());
      if(url.origin==='http://127.0.0.1:5173')return route.continue();
      let body={};try{body=route.request().postDataJSON();}catch{}
      const slug=url.pathname.split('/').at(-1);
      if(slug==='get-round')return route.fulfill({json:{title:'Contrato de prueba',message:'',needsKey:false}});
      if(slug==='take-open-turn')return route.fulfill({json:{state:'waiting',position:3}});
      if(slug==='queue-arcade'){
        if(offline)return route.fulfill({status:503,json:{error:'synthetic outage'}});
        if(body.action==='finish'){
          const score=verifyGame(42,body.ticks,body.jumps);
          assert.equal(body.consent,true); assert.equal(body.alias,'Rana veloz'); assert(score>0);
          records=[...records,{id,alias:body.alias,score}].sort((a,b)=>b.score-a.score).slice(0,3);submissions++;
          return route.fulfill({json:{records,ranked:true}});
        }
        return route.fulfill({json:body.action==='start'?{id,seed:42,records}:{records}});
      }
      return route.fulfill({status:400,json:{error:'external blocked'}});
    });
    const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:5173/r/${id}`);
    await page.getByPlaceholder('Como quieres aparecer').fill('Invitado de prueba');
    await page.getByRole('button',{name:'Solicitar turno para firmar',exact:true}).click();
    await page.getByRole('heading',{name:'Salto de firma'}).waitFor();
    await page.getByText('Rana del río',{exact:true}).waitFor();
    await page.locator('.arcade').screenshot({path:`${output}/arcade-${width}.png`});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Empezar',exact:true}).click();
    await page.getByRole('button',{name:'Pausa',exact:true}).waitFor();
    await page.getByRole('button',{name:'Pausa',exact:true}).click();
    assert(await page.getByRole('button',{name:'Saltar ↑',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Continuar',exact:true}).click();
    const game=newGame(42), jumps=[];
    while(!game.over){const jump=game.x<112&&game.x>104&&game.y===0&&game.score<3;if(jump)jumps.push(game.tick+1);stepGame(game,jump);}
    await page.evaluate(({ticks,jumps})=>{
      const canvas=document.querySelector('.arcade canvas');window.__arcadeFrame(1);
      for(let tick=1;tick<=ticks;tick++){
        if(jumps.includes(tick))canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));
        window.__arcadeFrame(1+tick*(1000/60+.001));
      }
    },{ticks:game.tick,jumps});
    await page.getByLabel('Tus iniciales o nombre').waitFor();
    assert.equal(await page.locator('.arcade-save input[type=checkbox]').count(),0);
    await page.getByLabel('Tus iniciales o nombre').fill('Rana veloz');
    await page.getByRole('button',{name:'Guardar récord'}).click();
    await page.getByText('¡Récord guardado!',{exact:true}).waitFor();
    assert.equal(submissions,1);
    await page.reload();
    await page.getByPlaceholder('Como quieres aparecer').fill('Invitado de prueba');
    await page.getByRole('button',{name:'Solicitar turno para firmar',exact:true}).click();
    await page.getByRole('heading',{name:'Salto de firma'}).waitFor();
    await page.getByText('Rana veloz',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Pausar animación',exact:true}).count(),0);
    const animation=await page.locator('.signing-leap-waiting').boundingBox();assert(animation.height<=90);
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await page.locator('.signing-leap-waiting .signing-frog').evaluate(el=>getComputedStyle(el).animationIterationCount),'infinite');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.signing-leap-waiting .signing-frog').evaluate(el=>getComputedStyle(el).animationName),'none');
    const first=await page.locator('.place-1').boundingBox(),second=await page.locator('.place-2').boundingBox();
    assert(first.x>second.x&&first.y<second.y,'First place is centered and taller');
    // A lower result must never ask for a name.
    await page.getByRole('button',{name:'Empezar',exact:true}).click();
    await page.getByRole('button',{name:'Pausa',exact:true}).waitFor();
    await page.evaluate(()=>{window.__arcadeFrame(1);for(let tick=1;tick<=200;tick++)window.__arcadeFrame(1+tick*(1000/60+.001));});
    await page.getByText('¡Casi! Prueba a saltar un poco antes.',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Tus iniciales o nombre').count(),0);
    offline=true;
    await page.getByRole('button',{name:'Volver a jugar',exact:true}).click();
    await page.getByText('No se pudo iniciar el juego. Inténtalo de nuevo.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Pausa',exact:true}).count(),0);
    assert.equal(await page.getByText(/Modo práctica/).count(),0);
    assert(await page.getByRole('heading',{name:'Estás en la cola',exact:true}).isVisible());
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}: qualifying-name prompt, no checkbox, verified save, persisted podium, lower score silent, compact animation, offline retry, no overflow/errors`);
    await context.close();
  }
} finally { await browser.close(); }
