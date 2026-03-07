import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function downloadResume(storagePath: string): Promise<{
    content: Buffer
    filename: string
} | null> {
    try {
        const { data, error } = await supabaseAdmin.storage
            .from('resumes')
            .download(storagePath)

        if (error || !data) {
            console.error('Error downloading resume:', error)
            return null
        }

        const buffer = Buffer.from(await data.arrayBuffer())
        const filename = storagePath.split('/').pop() || 'resume.pdf'
        // Remove the timestamp prefix from filename (e.g., "1234567890_resume.pdf" -> "resume.pdf")
        const cleanFilename = filename.replace(/^\d+_/, '')

        return { content: buffer, filename: cleanFilename }
    } catch (err) {
        console.error('Error downloading resume from storage:', err)
        return null
    }
}
