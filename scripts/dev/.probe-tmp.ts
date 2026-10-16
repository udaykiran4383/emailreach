import dns from 'dns/promises'
import { probeMailbox } from '../../lib/email/verifier'
const tests = process.argv.slice(2)
;(async () => {
  for (const e of tests) {
    const mx = (await dns.resolveMx(e.split('@')[1])).sort((a,b)=>a.priority-b.priority)[0].exchange
    console.log(e.padEnd(45), mx.padEnd(40), JSON.stringify(await probeMailbox(e, mx)))
  }
})()
