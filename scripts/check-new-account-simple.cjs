/**
 * check-new-account-simple.cjs - a NEW account opens in the Simple view (Tre, 2026-10-05, ask
 * ae6c85a3: "1. yes"), and pressing Advanced sticks across a reload.
 * Needs a FRESH throwaway @forgenta.test user created in SQL (auth.users + auth.identities with
 * crypt(); the profile trigger fires and the view_mode DEFAULT applies), onboarding_completed set
 * true so /dashboard does not bounce, passed as T_EMAIL / T_PASS. DELETE the user afterwards and
 * read auth.users back. Its writes are real, which is why it refuses anything but @forgenta.test.
 * First run 2026-10-05: simple on first open, footer shown, advanced after press and after reload;
 * the row read back 'advanced'.
 */
const {chromium}=require('@playwright/test');const fs=require('fs');
(async()=>{const env=fs.readFileSync('.env.local','utf8');const pk=(s,k)=>(s.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1].trim();
if(!/@forgenta\.test$/.test(process.env.T_EMAIL))process.exit(2);
const url=pk(env,'VITE_SUPABASE_URL'),anon=pk(env,'VITE_SUPABASE_PUBLISHABLE_KEY');const r=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email:process.env.T_EMAIL,password:process.env.T_PASS})});const s=await r.json();if(!s.access_token){console.log('signin',r.status);process.exit(2)}
const b=await chromium.launch();const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();await p.goto('http://localhost:8080/');await p.evaluate(([k,v])=>localStorage.setItem(k,JSON.stringify(v)),['sb-'+new URL(url).hostname.split('.')[0]+'-auth-token',s]);
const clear=async()=>{for(let i=0;i<12;i++){const ov=p.locator('.modal-overlay, [role=dialog][aria-modal=true]');if(!(await ov.count()))return;const btn=ov.first().getByRole('button',{name:/got it|skip|close|done|next|dismiss|start|continue|ok/i}).first();if(await btn.count())await btn.click().catch(()=>{});else await p.keyboard.press('Escape');await p.waitForTimeout(600);}};
await p.goto('http://localhost:8080/dashboard');const simple=p.getByRole('tab',{name:'Simple'});await simple.waitFor({timeout:30000});await p.waitForTimeout(3000);await clear();
const before=await simple.getAttribute('aria-selected');const footer=await p.getByTestId('show-advanced').count();await p.screenshot({path:'test-results/detail-load/fresh-account-simple.png'});
await p.getByRole('tab',{name:'Advanced'}).click();await p.waitForTimeout(2500);const after=await p.getByRole('tab',{name:'Advanced'}).getAttribute('aria-selected');
await p.reload();await p.getByRole('tab',{name:'Advanced'}).waitFor({timeout:30000});await p.waitForTimeout(3000);const persisted=await p.getByRole('tab',{name:'Advanced'}).getAttribute('aria-selected');
console.log(JSON.stringify({simpleSelectedOnFirstOpen:before,footerShown:footer,advancedAfterPress:after,advancedAfterReload:persisted}));await b.close();
process.exit(before==='true'&&footer===1&&after==='true'&&persisted==='true'?0:1)})();
