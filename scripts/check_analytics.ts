
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing env vars')
    process.exit(1)
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkCampaign() {
    // Get latest campaign
    const { data: campaigns, error: campError } = await supabase
        .from('campaigns')
        .select('id, name, created_at')
        .order('created_at', { ascending: false })
        .limit(1)

    if (campError || !campaigns?.length) {
        console.error('Error fetching campaign:', campError)
        return
    }

    const campaign = campaigns[0]
    console.log(`Latest Campaign: ${campaign.name} (${campaign.id})`)

    // Get recipient stats
    const { data: recipients, error: recError } = await supabase
        .from('email_recipients')
        .select('status, email, error_message')
        .eq('campaign_id', campaign.id)

    if (recError) {
        console.error('Error fetching recipients:', recError)
        return
    }

    console.log(`Total Recipients: ${recipients.length}`)

    const statusCounts = recipients.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1
        return acc
    }, {} as Record<string, number>)

    console.log('Status Counts:', statusCounts)

    // Show first 5 with errors
    const failed = recipients.filter(r => r.status === 'failed' || r.error_message)
    if (failed.length > 0) {
        console.log('\nSample Failures:')
        failed.slice(0, 5).forEach(r => {
            console.log(`- ${r.email}: [${r.status}] ${r.error_message}`)
        })
    } else {
        console.log('\nNo recipients have error messages.')
    }
}

checkCampaign()
