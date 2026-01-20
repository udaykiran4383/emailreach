
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Manually read .env ...
try {
    const files = ['.env', '.env.local'];
    files.forEach(file => {
        try {
            const envConfig = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
            envConfig.split('\n').forEach(line => {
                const [key, value] = line.split('=')
                if (key && value) {
                    process.env[key.trim()] = value.trim().replace(/^["']|["']$/g, '')
                }
            })
        } catch (e) { }
    });
} catch (e) { }

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkThreadingIds() {
    const email = 'uday.abhyuday@gmail.com'
    const { data, error } = await supabase
        .from('email_recipients')
        .select('email, status, gmail_message_id, gmail_thread_id')
        .eq('email', email)

    if (error) console.error(error)
    else console.log(JSON.stringify(data, null, 2))
}

checkThreadingIds()
