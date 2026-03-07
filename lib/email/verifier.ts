import dns from 'dns'
import net from 'net'
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

/**
 * Comprehensive email validation with multiple checks
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

    // 4. Check for role-based emails (warning, not blocking)
    const isRoleBased = ROLE_BASED_PREFIXES.some(prefix =>
        localPart === prefix || localPart.startsWith(prefix + '.') || localPart.startsWith(prefix + '-')
    )

    // 5. Check domain TLD exists (basic check)
    const tld = domain.split('.').pop()
    if (!tld || tld.length < 2) {
        return { status: 'invalid', reason: 'Invalid domain TLD' }
    }

    // 6. MX Record verification (SMTP verification removed for speed - most servers block port 25)
    try {
        const addresses = await resolveMx(domain)

        if (!addresses || addresses.length === 0) {
            return { status: 'invalid', reason: 'No MX records found - domain cannot receive email' }
        }

        // If role-based, mark as risky
        if (isRoleBased) {
            return {
                status: 'risky',
                reason: 'Role-based email address (may not reach a real person)',
                details: { mxRecords: addresses }
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

async function verifyEmailSMTP(email: string, mxExchange: string): Promise<VerificationResult> {
    return new Promise((resolve) => {
        const socket = new net.Socket()
        let step = 0
        let isResolved = false

        // Timeout for SMTP operation
        socket.setTimeout(2000) // 2 seconds max (faster verification)

        const cleanup = () => {
            if (!socket.destroyed) {
                try { socket.write('QUIT\r\n') } catch (e) { }
                socket.destroy()
            }
        }

        const safeResolve = (result: VerificationResult) => {
            if (!isResolved) {
                isResolved = true
                cleanup()
                resolve(result)
            }
        }

        socket.on('data', (data) => {
            const response = data.toString()
            const code = parseInt(response.substring(0, 3))

            // 5xx = permanent error (mailbox doesn't exist)
            if (code >= 500 && code < 600) {
                const lowerResp = response.toLowerCase()
                if (lowerResp.includes('user') || lowerResp.includes('mailbox') ||
                    lowerResp.includes('recipient') || lowerResp.includes('address') ||
                    code === 550 || code === 551 || code === 552 || code === 553) {
                    safeResolve({ status: 'invalid', reason: `Mailbox does not exist (${code})` })
                    return
                }
            }

            // 4xx = temporary error (greylisting, throttling)
            if (code >= 400 && code < 500) {
                safeResolve({ status: 'risky', reason: `SMTP temp error: ${code}` })
                return
            }

            // SMTP conversation steps
            if (step === 0) { // Initial greeting (220)
                socket.write(`EHLO email-verifier.local\r\n`)
                step++
            } else if (step === 1) { // EHLO response
                socket.write(`MAIL FROM:<verify@email-verifier.local>\r\n`)
                step++
            } else if (step === 2) { // MAIL FROM response
                socket.write(`RCPT TO:<${email}>\r\n`)
                step++
            } else if (step === 3) { // RCPT TO response - THE KEY CHECK
                // 2xx = recipient accepted = mailbox exists!
                if (code >= 200 && code < 300) {
                    safeResolve({ status: 'safe', details: { smtpVerified: true, code } })
                }
            }
        })

        socket.on('error', () => {
            // Connection refused = port 25 blocked, can't verify
            safeResolve({ status: 'risky', reason: 'SMTP Connection Failed (Port 25 blocked)' })
        })

        socket.on('timeout', () => {
            safeResolve({ status: 'risky', reason: 'SMTP Timeout' })
        })

        try {
            socket.connect(25, mxExchange)
        } catch (e) {
            safeResolve({ status: 'risky', reason: 'SMTP Connect Error' })
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
