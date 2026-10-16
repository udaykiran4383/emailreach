import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { API_TOKEN_PREFIX, isApiTokenRoute } from '@/lib/api-token-routes'

export async function updateSession(request: NextRequest) {
    // Open-tracking pixels and resume links are fetched by recipients: no session, no redirect
    if (request.nextUrl.pathname.startsWith('/api/track') || request.nextUrl.pathname.startsWith('/r/')) {
        return NextResponse.next({ request })
    }

    // OAuth sign-in falls back to the Site URL when the callback isn't on Supabase's
    // redirect allow-list — forward the code to the real callback instead of dropping it
    if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
        const url = request.nextUrl.clone()
        url.pathname = '/auth/callback'
        return NextResponse.redirect(url)
    }

    // Personal API tokens (MCP server) work only on allowlisted routes. Requests
    // carrying a token anywhere else are refused here, so getUser() can accept
    // a token whenever one reaches a route. The route validates the token itself.
    const authHeader = request.headers.get('authorization') || ''
    if (authHeader.startsWith(`Bearer ${API_TOKEN_PREFIX}`)) {
        if (!isApiTokenRoute(request.method, request.nextUrl.pathname)) {
            return NextResponse.json({ error: 'API tokens are not allowed on this route' }, { status: 403 })
        }
        return NextResponse.next({ request })
    }

    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Do not run code between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to debug
    // issues with users being randomly logged out.

    // IMPORTANT: DO NOT REMOVE auth.getUser()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (
        !user &&
        !request.nextUrl.pathname.startsWith('/auth') &&
        !request.nextUrl.pathname.startsWith('/api/cron') && // Allow cron jobs without auth if needed (or protect them differently)
        !request.nextUrl.pathname.startsWith('/api/gmail') && // Allow gmail callbacks
        request.nextUrl.pathname !== '/' // Allow public landing page
    ) {
        // no user, potentially respond by redirecting the user to the login page
        const url = request.nextUrl.clone()
        url.pathname = '/auth/login'
        return NextResponse.redirect(url)
    }

    // If user is logged in and tries to access auth pages, redirect to dashboard
    if (user && request.nextUrl.pathname.startsWith('/auth')) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    // If user is at root, redirect to dashboard
    if (user && request.nextUrl.pathname === '/') {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    return supabaseResponse
}
