import { JSDOM, VirtualConsole } from 'jsdom'
import fs from 'fs'

let js = fs.readFileSync(fs.readdirSync('dist/assets').filter(f=>f.startsWith('index-')&&f.endsWith('.js')).map(f=>'dist/assets/'+f)[0],'utf8')
js = js.replace(/export\{[^}]*\};?/g, '')          // bundle is an ES module; strip the export
js = js.replace(/import\(/g, 'Promise.reject.bind(Promise)(')  // no dynamic chunks in this harness
const errs = []
const vc = new VirtualConsole()
vc.on('jsdomError', e => errs.push('jsdomError: ' + (e.stack||e.message)))
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')))
vc.on('warn',  (...a) => errs.push('console.warn: '  + a.join(' ')))

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  runScripts: 'outside-only', url: 'https://app.test/', pretendToBeVisual: true, virtualConsole: vc
})
const w = dom.window
w.matchMedia = w.matchMedia || (q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }))
w.fetch = () => new Promise(() => {})            // never resolves: freeze at "Loading"
w.scrollTo = () => {}

try { w.eval(js) } catch (e) { errs.push('EVAL THREW: ' + e.stack) }

await new Promise(r => setTimeout(r, 900))
const root = w.document.getElementById('root')
console.log('--- #root innerHTML length:', root.innerHTML.length)
console.log('--- text:', (root.textContent||'').slice(0,200) || '(EMPTY — blank page)')
console.log('--- messages ---')
console.log(errs.length ? errs.slice(0,6).join('\n\n') : '(none)')
