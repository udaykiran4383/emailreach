import dns from 'dns'
import net from 'net'
import os from 'os'
import { promisify } from 'util'

const resolveMx = promisify(dns.resolveMx)

export type VerificationStatus = 'safe' | 'risky' | 'invalid'

export interface VerificationResult {
    status: VerificationStatus
    reason?: string
    details?: any
}

// Common disposable email domains to block (100+ domains)
const DISPOSABLE_DOMAINS = new Set([
    // Popular temp mail services
    'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.net',
    'guerrillamail.com', 'guerrillamail.org', 'guerrillamail.net', 'guerrillamail.biz',
    'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com',
    'throwaway.email', 'throwawaymail.com', 'throwmail.com',
    '10minutemail.com', '10minutemail.net', '10minutemail.org', '10minmail.com',
    'fakeinbox.com', 'trashmail.com', 'trashmail.net', 'trashmail.org',
    'dispostable.com', 'mailnesia.com', 'tempinbox.com', 'tempmailaddress.com',
    'getnada.com', 'nada.email', 'sharklasers.com', 'grr.la', 'spam4.me',
    'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.fr.nf',
    'mohmal.com', 'fakemailgenerator.com', 'emailondeck.com', 'maildrop.cc',
    'inboxalias.com', 'spamgourmet.com', 'mytrashmail.com', 'mailcatch.com',
    'mintemail.com', 'burnermail.io', 'jetable.org', 'deadaddress.com', 'mailna.co',
    // Additional common ones
    'mailnator.com', 'sogetthis.com', 'mailin8r.com', 'mailimate.com',
    'spambox.us', 'spam.la', 'spamfree.eu', 'spamfree24.org', 'spamfree24.de',
    'anonymbox.com', 'getairmail.com', 'guerrillamailblock.com', 'imgv.de',
    'emailsensei.com', 'incognitomail.com', 'incognitomail.net', 'incognitomail.org',
    'instantemailaddress.com', 'emailisvalid.com', 'mailforspam.com',
    'tempr.email', 'tempemail.net', 'tempsky.com', 'fakemailgenerator.net',
    'mt2009.com', 'mt2014.com', 'thankyou2010.com', 'trash2009.com',
    'binkmail.com', 'safetymail.info', 'veryrealemail.com', 'veryrealmail.com',
    'crazymailing.com', 'emailfake.com', 'fakemail.fr', 'fakemails.app',
    'mailsac.com', 'emailna.co', 'emkei.cz', 'emailfreedom.ml',
    'protonmail.ch', 'tutanota.com', 'tutanota.de', 'tutamail.com', 'tuta.io',
    // Russian/international temp mails
    'mailru.com', 'inbox.ru', 'mail.ru', 'bk.ru', 'list.ru',
    // Common test domains
    'test.com', 'example.com', 'example.org', 'example.net', 'localhost.com',
])

// Common typos in popular email domains (expanded)
const DOMAIN_TYPOS: Record<string, string> = {
    // Gmail typos
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmil.com': 'gmail.com',
    'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com',
    'gmail.co': 'gmail.com', 'gmal.com': 'gmail.com', 'gamail.com': 'gmail.com',
    'gimail.com': 'gmail.com', 'gemail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
    'gmailc.om': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.cm': 'gmail.com',
    'gmail.cim': 'gmail.com', 'gmail.cpm': 'gmail.com', 'gmail.comm': 'gmail.com',
    'g]mail.com': 'gmail.com', 'gmaio.com': 'gmail.com', 'gmale.com': 'gmail.com',
    // Yahoo typos
    'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
    'yahoocom': 'yahoo.com', 'yaoo.com': 'yahoo.com', 'yhaoo.com': 'yahoo.com',
    'yhoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.cm': 'yahoo.com',
    // Hotmail/Outlook typos
    'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
    'homail.com': 'hotmail.com', 'hotmeil.com': 'hotmail.com', 'hotmaill.com': 'hotmail.com',
    'hotmail.co': 'hotmail.com', 'hitmail.com': 'hotmail.com', 'hormail.com': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outlook.con': 'outlook.com',
    'outlool.com': 'outlook.com', 'outloook.com': 'outlook.com', 'outlook.co': 'outlook.com',
    'outllook.com': 'outlook.com', 'otlook.com': 'outlook.com', 'outlok.co': 'outlook.com',
    // iCloud typos
    'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com', 'iclould.com': 'icloud.com',
    'icoud.com': 'icloud.com', 'icloud.co': 'icloud.com',
    // Other common
    'protonmal.com': 'protonmail.com', 'protonmail.con': 'protonmail.com',
    'redifffmail.com': 'rediffmail.com', 'rediffmal.com': 'rediffmail.com',
}

// Role-based email prefixes (often don't reach real people)
const ROLE_BASED_PREFIXES = [
    'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
    'mailer-daemon', 'mailer_daemon', 'postmaster', 'hostmaster',
    'admin', 'administrator', 'webmaster', 'sysadmin', 'root',
    'info', 'information', 'support', 'helpdesk', 'help',
    'sales', 'marketing', 'contact', 'hello', 'hi', 'hey',
    'team', 'office', 'jobs', 'careers', 'hr', 'recruitment',
    'billing', 'accounts', 'finance', 'payments', 'invoices',
    'feedback', 'suggestions', 'complaints', 'abuse', 'spam',
    'security', 'privacy', 'legal', 'press', 'media', 'news',
    'notify', 'notification', 'notifications', 'alerts', 'alert',
    'test', 'testing', 'dev', 'development', 'staging', 'demo',
    'newsletter', 'updates', 'subscribe', 'unsubscribe',
]

// Known problematic email patterns
const INVALID_PATTERNS = [
    /^[0-9]+@/, // Starts with only numbers
    /\.{2,}/, // Double dots
    /@.*@/, // Multiple @ symbols
    /^\./, // Starts with dot
    /\.$/, // Ends with dot (before @)
    /^-/, // Starts with hyphen
    /-\./, // Hyphen before dot
    /\.-/, // Dot before hyphen
]

// Prefixes that never reach a human: sending to them only produces bounces or silence
const NEVER_HUMAN_PREFIXES = [
    'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
    'mailer-daemon', 'mailer_daemon', 'postmaster', 'abuse',
]

// Domain -> MX records, cached for an hour so large lists don't hammer DNS
const MX_CACHE_TTL_MS = 60 * 60 * 1000
const mxCache = new Map<string, { expires: number; records?: dns.MxRecord[]; errorCode?: string }>()

async function lookupMx(domain: string): Promise<dns.MxRecord[]> {
    const cached = mxCache.get(domain)
    if (cached && cached.expires > Date.now()) {
        if (cached.records) return cached.records
        const err: any = new Error(`DNS ${cached.errorCode}`)
        err.code = cached.errorCode
        throw err
    }
    try {
        const records = await resolveMx(domain)
        mxCache.set(domain, { expires: Date.now() + MX_CACHE_TTL_MS, records })
        return records
    } catch (error: any) {
        // Only cache permanent answers; temporary failures should be retried
        if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
            mxCache.set(domain, { expires: Date.now() + MX_CACHE_TTL_MS, errorCode: error.code })
        }
        throw error
    }
}

function matchesPrefix(localPart: string, prefixes: string[]): boolean {
    return prefixes.some(prefix =>
        localPart === prefix || localPart.startsWith(prefix + '.') || localPart.startsWith(prefix + '-') || localPart.startsWith(prefix + '+')
    )
}

/**
 * Comprehensive email validation with multiple checks (format, typos, disposable, MX).
 * Does not contact the mailbox; use verifyEmail() for the deeper check.
 */
export async function verifyEmailDNS(email: string): Promise<VerificationResult> {
    if (!email || !email.includes('@')) {
        return { status: 'invalid', reason: 'Invalid email format' }
    }

    const normalizedEmail = email.toLowerCase().trim()
    const [localPart, domain] = normalizedEmail.split('@')

    // 1. Basic format validation
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    if (!emailRegex.test(normalizedEmail)) {
        return { status: 'invalid', reason: 'Invalid email format' }
    }

    // 1.5 Check for problematic patterns
    for (const pattern of INVALID_PATTERNS) {
        if (pattern.test(localPart)) {
            return { status: 'invalid', reason: 'Invalid email pattern detected' }
        }
    }

    // 2. Check for domain typos
    if (DOMAIN_TYPOS[domain]) {
        return {
            status: 'invalid',
            reason: `Likely typo: Did you mean ${localPart}@${DOMAIN_TYPOS[domain]}?`
        }
    }

    // 3. Check for disposable email domains
    if (DISPOSABLE_DOMAINS.has(domain)) {
        return { status: 'invalid', reason: 'Disposable email domain not allowed' }
    }

    // 3.5 Addresses that are never read by a person
    if (matchesPrefix(localPart, NEVER_HUMAN_PREFIXES)) {
        return { status: 'invalid', reason: 'No-reply/system address (never reaches a person)' }
    }

    // 4. Check for role-based emails (warning, not blocking)
    const isRoleBased = matchesPrefix(localPart, ROLE_BASED_PREFIXES)

    // 5. Check domain TLD exists (basic check)
    const tld = domain.split('.').pop()
    if (!tld || tld.length < 2) {
        return { status: 'invalid', reason: 'Invalid domain TLD' }
    }

    // 6. MX Record verification
    try {
        const addresses = await lookupMx(domain)

        if (!addresses || addresses.length === 0) {
            return { status: 'invalid', reason: 'No MX records found - domain cannot receive email' }
        }

        // A "null MX" (RFC 7505) explicitly says the domain accepts no mail
        if (addresses.length === 1 && (addresses[0].exchange === '' || addresses[0].exchange === '.')) {
            return { status: 'invalid', reason: 'Domain does not accept email (null MX)' }
        }

        // If role-based, mark as risky
        if (isRoleBased) {
            return {
                status: 'risky',
                reason: 'Role-based email address (may not reach a real person)',
                details: { mxRecords: addresses, roleBased: true }
            }
        }

        // MX exists = domain can receive email = safe
        return {
            status: 'safe',
            details: { mxRecords: addresses }
        }

    } catch (error: any) {
        if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
            return { status: 'invalid', reason: 'Domain not found or no MX records' }
        }

        if (error.code === 'ESERVFAIL' || error.code === 'ETIMEOUT') {
            return { status: 'risky', reason: `DNS Error: ${error.code} (Temporary failure)` }
        }

        return { status: 'risky', reason: `DNS Lookup Error: ${error.code || error.message}` }
    }
}

// These providers accept every RCPT TO or block probing from most IPs, so an SMTP
// probe tells us nothing for them. (Google Workspace answers honestly, so it is probed.) MX-valid addresses on these are treated as safe.
const UNPROBEABLE_MX_PATTERNS = [
    /\.outlook\.com$/, /\.protection\.outlook\.com$/, /hotmail\.com$/, // Microsoft 365 / Outlook
    /yahoodns\.net$/, /\.yahoo\.com$/,                      // Yahoo
    /\.icloud\.com$/, /\.me\.com$/,                         // iCloud
]

function isUnprobeable(mxRecords: dns.MxRecord[]): boolean {
    return mxRecords.some(mx => UNPROBEABLE_MX_PATTERNS.some(p => p.test(mx.exchange.toLowerCase())))
}

/**
 * Deep verification: verifyEmailDNS + the first available deeper check:
 * Reacher (REACHER_URL) > MillionVerifier (EMAIL_VERIFIER_API_KEY) > SMTP RCPT probe (ENABLE_SMTP_VERIFY=true).
 * Use this before sending.
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
    const base = await verifyEmailDNS(email)
    if (base.status === 'invalid') return base

    const normalizedEmail = email.toLowerCase().trim()

    // details.confirmed = mailbox positively confirmed (not just a valid domain)
    // details.catchAll = domain accepts every address
    if (process.env.REACHER_URL) {
        const reacherResult = await verifyViaReacher(normalizedEmail)
        if (reacherResult) {
            return { ...reacherResult, details: { ...base.details, ...reacherResult.details } }
        }
        // Reacher unreachable or unparseable: fall through to the next layer
    }

    if (process.env.EMAIL_VERIFIER_API_KEY) {
        const apiResult = await verifyViaApi(normalizedEmail)
        if (apiResult) {
            return {
                ...apiResult,
                details: {
                    ...base.details,
                    api: apiResult.details,
                    confirmed: apiResult.details?.result === 'ok',
                    catchAll: apiResult.details?.result === 'catch_all' || undefined,
                },
            }
        }
        // API failed: fall through to the next layer
    }

    if (process.env.ENABLE_SMTP_VERIFY === 'true' && base.status === 'safe') {
        const mxRecords: dns.MxRecord[] = base.details?.mxRecords || []
        if (mxRecords.length === 0 || isUnprobeable(mxRecords)) {
            return { ...base, details: { ...base.details, smtp: { status: 'skipped', reason: 'Provider does not answer probes' } } }
        }
        const mx = [...mxRecords].sort((a, b) => a.priority - b.priority)[0].exchange
        const smtp = await probeMailbox(normalizedEmail, mx)
        if (smtp.status === 'invalid') {
            return { status: 'invalid', reason: smtp.reason, details: { ...base.details, smtp } }
        }
        if (smtp.status === 'safe') {
            // Probe a random address: if that is accepted too, the domain is catch-all
            const domain = normalizedEmail.split('@')[1]
            const random = `zz-${Math.random().toString(36).slice(2, 12)}@${domain}`
            const catchAll = await probeMailbox(random, mx)
            if (catchAll.status === 'safe') {
                return { status: 'risky', reason: 'Catch-all domain (mailbox existence cannot be confirmed)', details: { ...base.details, smtp: { ...smtp, catchAll: true }, catchAll: true } }
            }
            return { ...base, details: { ...base.details, smtp: { ...smtp, catchAll: false }, confirmed: true, catchAll: false } }
        }
        // Timeout / port 25 blocked / greylisting: keep the MX verdict, but tell the caller
        return { ...base, details: { ...base.details, smtp } }
    }

    return base
}

/**
 * Verify many emails with bounded concurrency. Keys are the emails as given.
 */
export async function verifyEmailsBatch(emails: string[], concurrency = 8): Promise<Map<string, VerificationResult>> {
    const results = new Map<string, VerificationResult>()
    const queue = [...new Set(emails)]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
            const email = queue.shift()!
            try {
                results.set(email, await verifyEmail(email))
            } catch (error: any) {
                results.set(email, { status: 'risky', reason: `Verification error: ${error.message}` })
            }
        }
    })
    await Promise.all(workers)
    return results
}

/**
 * Self-hosted Reacher (github.com/reacherhq/check-if-email-exists).
 * Run with `docker run -p 8080:8080 reacherhq/backend:latest` on a host that allows outbound port 25.
 * Returns null on network/parse errors so the caller can fall back.
 */
async function verifyViaReacher(email: string): Promise<VerificationResult | null> {
    const base = process.env.REACHER_URL!.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.REACHER_SECRET) headers['x-reacher-secret'] = process.env.REACHER_SECRET
    try {
        const res = await fetch(`${base}/v0/check_email`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ to_email: email }),
            signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) return null
        const json: any = await res.json()
        const reachable = String(json?.is_reachable || '').toLowerCase()
        if (!['safe', 'risky', 'invalid', 'unknown'].includes(reachable)) return null

        const smtp = json?.smtp && typeof json.smtp === 'object' ? json.smtp : {}
        const misc = json?.misc && typeof json.misc === 'object' ? json.misc : {}
        const details = {
            provider: 'reacher',
            reachable,
            smtp: {
                isCatchAll: smtp.is_catch_all === true,
                isDeliverable: smtp.is_deliverable === true,
                isDisabled: smtp.is_disabled === true,
                hasFullInbox: smtp.has_full_inbox === true,
                canConnect: smtp.can_connect_smtp === true,
            },
            isRoleAccount: misc.is_role_account === true,
            acceptsMail: json?.mx?.accepts_mail,
        }

        if (reachable === 'invalid') {
            return { status: 'invalid', reason: 'Mailbox does not exist (Reacher)', details: { ...details, confirmed: false } }
        }
        if (misc.is_disposable === true) {
            return { status: 'invalid', reason: 'Disposable email domain not allowed', details: { ...details, confirmed: false } }
        }
        if (smtp.is_disabled === true) {
            return { status: 'invalid', reason: 'Mailbox is disabled (Reacher)', details: { ...details, confirmed: false } }
        }
        if (smtp.has_full_inbox === true) {
            return { status: 'invalid', reason: 'Mailbox is full (Reacher)', details: { ...details, confirmed: false } }
        }
        if (smtp.is_catch_all === true) {
            return { status: 'risky', reason: 'Catch-all domain (mailbox existence cannot be confirmed)', details: { ...details, confirmed: false, catchAll: true } }
        }
        if (reachable === 'safe' && smtp.is_deliverable === true) {
            return { status: 'safe', details: { ...details, confirmed: true, catchAll: false } }
        }
        return {
            status: 'risky',
            reason: reachable === 'unknown' ? 'Reacher could not confirm mailbox' : 'Reacher marked mailbox as risky',
            details: { ...details, confirmed: false },
        }
    } catch (error) {
        console.warn('Reacher verification error:', error)
        return null
    }
}

async function verifyViaApi(email: string): Promise<VerificationResult | null> {
    const provider = (process.env.EMAIL_VERIFIER_PROVIDER || 'millionverifier').toLowerCase()
    const key = process.env.EMAIL_VERIFIER_API_KEY!
    if (provider !== 'millionverifier') {
        console.warn(`Unknown EMAIL_VERIFIER_PROVIDER "${provider}", skipping API verification`)
        return null
    }
    try {
        const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&timeout=10`
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (!res.ok) return null
        const json: any = await res.json()
        const result = String(json?.result || '').toLowerCase()
        if (json?.error) return null
        switch (result) {
            case 'ok':
                return { status: 'safe', details: { provider, result } }
            case 'catch_all':
                return { status: 'risky', reason: 'Catch-all domain (mailbox existence cannot be confirmed)', details: { provider, result } }
            case 'unknown':
                return { status: 'risky', reason: 'Verifier could not confirm mailbox', details: { provider, result } }
            case 'invalid':
                return { status: 'invalid', reason: 'Mailbox does not exist (verifier)', details: { provider, result } }
            case 'disposable':
                return { status: 'invalid', reason: 'Disposable email domain not allowed', details: { provider, result } }
            default:
                return null
        }
    } catch (error) {
        console.warn('Email verifier API error:', error)
        return null
    }
}

export interface SmtpProbeResult {
    status: VerificationStatus | 'unknown'
    reason?: string
    code?: number
}

// A 5xx that is about the connecting IP or policy (blocklists, 5.7.x) says nothing about the mailbox
const POLICY_REJECTION = /\b5\.7\.\d+\b|spamhaus|blocklist|blacklist|block(ed)? using|listed (by|in|on)|\bpbl\b|reputation|policy|banned|access denied|relay(ing)? (denied|not permitted)|not authori[sz]ed/i

/** Turns the server's reply to RCPT TO into a verdict. Exported for tests. */
export function classifyRcptReply(code: number, text: string): SmtpProbeResult {
    if (code >= 200 && code < 300) return { status: 'safe', code }
    if (code >= 500 && POLICY_REJECTION.test(text)) {
        return { status: 'unknown', reason: `Server refused the check (${code}, IP/policy block)`, code }
    }
    if ([550, 551, 553].includes(code) || (code >= 500 && /user|mailbox|recipient|address|exist|unknown/i.test(text))) {
        return { status: 'invalid', reason: `Mailbox does not exist (${code})`, code }
    }
    return { status: 'unknown', reason: `RCPT reply ${code}`, code }
}

/**
 * SMTP RCPT TO probe. Needs outbound port 25, which most cloud hosts and
 * home ISPs block, hence opt-in via ENABLE_SMTP_VERIFY.
 */
export function probeMailbox(email: string, mxExchange: string): Promise<SmtpProbeResult> {
    return new Promise((resolve) => {
        const socket = new net.Socket()
        const helo = process.env.SMTP_VERIFY_HELO || os.hostname()
        const mailFrom = process.env.SMTP_VERIFY_FROM || `verify@${helo}`
        let buffer = ''
        let step = 0
        let done = false

        const finish = (result: SmtpProbeResult) => {
            if (done) return
            done = true
            try { socket.write('QUIT\r\n') } catch { }
            socket.destroy()
            resolve(result)
        }

        // Called once per complete SMTP reply (multi-line "250-" replies are collapsed)
        const onReply = (code: number, text: string) => {
            if (step === 3) return finish(classifyRcptReply(code, text))
            if (code >= 400) {
                // Rejected before RCPT (blocklisted IP, greylisting, policy): no verdict
                return finish({ status: 'unknown', reason: `SMTP ${code} before RCPT`, code })
            }
            if (step === 0) socket.write(`EHLO ${helo}\r\n`)
            else if (step === 1) socket.write(`MAIL FROM:<${mailFrom}>\r\n`)
            else if (step === 2) socket.write(`RCPT TO:<${email}>\r\n`)
            step++
        }

        socket.setTimeout(8000)
        socket.on('data', (data) => {
            buffer += data.toString()
            let idx: number
            let lines: string[] = []
            while ((idx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, idx).replace(/\r$/, '')
                buffer = buffer.slice(idx + 1)
                lines.push(line)
                // "250-..." continues, "250 ..." ends the reply
                if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
                    onReply(parseInt(line.slice(0, 3), 10), lines.join('\n'))
                    lines = []
                    if (done) return
                }
            }
            if (lines.length) buffer = lines.join('\n') + '\n' + buffer
        })
        socket.on('error', (err: any) => finish({ status: 'unknown', reason: `SMTP connection failed (${err.code || err.message})` }))
        socket.on('timeout', () => finish({ status: 'unknown', reason: 'SMTP timeout' }))
        socket.on('close', () => finish({ status: 'unknown', reason: 'SMTP connection closed' }))

        try {
            socket.connect(25, mxExchange)
        } catch {
            finish({ status: 'unknown', reason: 'SMTP connect error' })
        }
    })
}

/**
 * Quick validation without SMTP (for UI/fast checks)
 */
export function quickValidateEmail(email: string): { valid: boolean; error?: string } {
    if (!email || !email.includes('@')) {
        return { valid: false, error: 'Invalid email format' }
    }

    const normalizedEmail = email.toLowerCase().trim()
    const [localPart, domain] = normalizedEmail.split('@')

    // Basic format
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    if (!emailRegex.test(normalizedEmail)) {
        return { valid: false, error: 'Invalid email format' }
    }

    // Typo check
    if (DOMAIN_TYPOS[domain]) {
        return { valid: false, error: `Typo detected: Did you mean ${localPart}@${DOMAIN_TYPOS[domain]}?` }
    }

    // Disposable check
    if (DISPOSABLE_DOMAINS.has(domain)) {
        return { valid: false, error: 'Disposable email not allowed' }
    }

    return { valid: true }
}
