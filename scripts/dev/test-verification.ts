// Dev helper: run the MX verifier against addresses given on the command line.
//   npx tsx scripts/dev/test-verification.ts someone@company.com other@company.com
import { verifyEmailDNS } from '../../lib/email/verifier'

async function test() {
    const emails = process.argv.slice(2)
    if (emails.length === 0) {
        console.error('Usage: npx tsx scripts/dev/test-verification.ts <email> [email...]')
        process.exit(1)
    }

    for (const email of emails) {
        try {
            const start = Date.now()
            const result = await verifyEmailDNS(email)
            console.log(`Email: ${email}`)
            console.log(`Duration: ${Date.now() - start}ms`)
            console.log(`Status: ${result.status}`)
            console.log(`Reason: ${result.reason}`)
            console.log(`Details: ${JSON.stringify(result.details, null, 2)}`)
            console.log('---')
        } catch (error) {
            console.error(`Error verifying ${email}:`, error)
        }
    }
}

test()
