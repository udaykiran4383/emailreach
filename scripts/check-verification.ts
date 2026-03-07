import { verifyEmailDNS } from '../lib/email/verifier'

async function runTest() {
    const args = process.argv.slice(2);
    const emailsToCheck = args.length > 0 ? args : [
        'uday.abhyuday@gmail.com',         // Valid Gmail (Safe)
        'krish@bimape.com',                // Domain exists, but maybe issues? (Risky/Safe)
        'test@invalid-domain-12345-xyz.com', // Invalid Domain (Invalid)
        'invalid-email-format',            // Bad format (Invalid)
        'support@google.com'               // Valid (Safe)
    ];

    console.log('Starting Enhanced Email Verification Test...\n')

    for (const email of emailsToCheck) {
        console.log(`Testing: ${email}`)
        const startTime = Date.now()
        const result = await verifyEmailDNS(email)
        const duration = Date.now() - startTime

        const statusIcon = result.status === 'safe' ? '✅' :
            result.status === 'risky' ? '⚠️' : '❌'

        console.log(`Status: ${statusIcon} ${result.status.toUpperCase()}`)
        if (result.reason) {
            console.log(`Reason: ${result.reason}`)
        }
        console.log(`Time: ${duration}ms\n`)
    }
}

runTest().catch(console.error)
