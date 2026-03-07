import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

// Use admin client for storage operations (bypasses RLS)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function POST(request: Request) {
    const user = await getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const formData = await request.formData()
        const file = formData.get('resume') as File

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        }

        // Only allow PDF files
        if (file.type !== 'application/pdf') {
            return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 })
        }

        // Max 5MB
        if (file.size > 5 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
        }

        const buffer = Buffer.from(await file.arrayBuffer())
        const fileName = `${user.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

        const { data, error } = await supabaseAdmin.storage
            .from('resumes')
            .upload(fileName, buffer, {
                contentType: 'application/pdf',
                upsert: false,
            })

        if (error) {
            console.error('Storage upload error:', error)
            return NextResponse.json({ error: `Failed to upload: ${error.message}` }, { status: 500 })
        }

        return NextResponse.json({
            path: data.path,
            fileName: file.name,
        })
    } catch (error) {
        console.error('Upload error:', error)
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
}
