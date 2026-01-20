import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function debug() {
    console.log('=== Debugging Reply Detection ===\n')

    // 1. Get all recipients
    const { data: recipients, error } = await supabase
        .from('email_recipients')
        .select('id, email, name, status, gmail_thread_id, gmail_message_id, replied_at, campaign_id')
        .limit(20)

    if (error) {
        console.error('Error fetching recipients:', error)
        return
    }

    console.log('Recipients in database:')
    console.log('------------------------')
    for (const r of recipients) {
        console.log(`
Email: ${r.email}
Name: ${r.name || '(none)'}
Status: ${r.status}
Thread ID: ${r.gmail_thread_id || '❌ NOT STORED'}
Message ID: ${r.gmail_message_id || '(none)'}
Replied At: ${r.replied_at || '(not replied)'}
Campaign ID: ${r.campaign_id}
---`)
    }

    // 2. Check if gmail_thread_id column exists and has values
    const threadsWithData = recipients.filter(r => r.gmail_thread_id)
    console.log(`\n📊 Summary:`)
    console.log(`Total recipients: ${recipients.length}`)
    console.log(`Recipients with Thread ID: ${threadsWithData.length}`)
    console.log(`Recipients marked as 'replied': ${recipients.filter(r => r.status === 'replied').length}`)
    console.log(`Recipients marked as 'sent': ${recipients.filter(r => r.status === 'sent').length}`)

    if (threadsWithData.length === 0) {
        console.log('\n⚠️ PROBLEM FOUND: No recipients have gmail_thread_id stored!')
        console.log('This means the email sending process is not saving the thread ID.')
        console.log('The sync cannot accurately detect replies without thread IDs.')
    }
}

debug().catch(console.error)
