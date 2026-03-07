
import { verifyEmailDNS } from './lib/email/verifier';

async function test() {
    console.log('Testing email verification logic against Razorpay...');
    const emails = [
        'arpit@razorpay.com',
        'chitbhanu@razorpay.com',
        'mayank@razorpay.com',
        'invalid-user-123@razorpay.com'
    ];

    for (const email of emails) {
        try {
            console.log(`Verifying ${email}...`);
            const start = Date.now();
            const result = await verifyEmailDNS(email);
            const duration = Date.now() - start;

            console.log(`Email: ${email}`);
            console.log(`Duration: ${duration}ms`);
            console.log(`Status: ${result.status}`);
            console.log(`Reason: ${result.reason}`);
            console.log(`Details: ${JSON.stringify(result.details, null, 2)}`);
            console.log('---');
        } catch (error) {
            console.error(`Error verifying ${email}:`, error);
        }
    }
}

test();
