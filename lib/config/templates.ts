// Template configuration for personal vs customer use
// Set USE_PERSONAL_TEMPLATES=true in .env.local for your personal use
// For production/customers, omit this variable or set to false

const isPersonalUse = process.env.NEXT_PUBLIC_USE_PERSONAL_TEMPLATES === 'true'

// ============================================
// PERSONAL TEMPLATES (Customize for your use)
// ============================================
const PERSONAL_CONFIG = {
    senderOptions: {
        gmail: { value: 'gmail', label: 'Gmail', email: 'your-email@gmail.com' },
    },
    defaultSubject: 'Exploring Entry-Level Opportunities at {{company}}',
    defaultBody: `Hello {{name}},

I'm reaching out because I'm currently exploring entry-level opportunities at {{company}}.

I have hands-on experience building scalable production systems, including backend APIs and full-stack applications. I've also worked with cloud services and CI/CD pipelines during my internships.

I'd be grateful if you could share any relevant openings or guide me to the right person/team for entry-level roles. My resume is attached for your review.

Thank you for your time and consideration.`,
    defaultFollowUp: `Hi {{name}},

Just wanted to follow up on my previous email. I'm still very interested in exploring opportunities at {{company}}.

If you could point me to the right person to speak with, I'd really appreciate it.

Thanks again!`,
    defaultResumePath: '',
}

// ============================================
// CUSTOMER TEMPLATES (Generic professional outreach)
// ============================================
const CUSTOMER_CONFIG = {
    senderOptions: {
        primary: { value: 'primary', label: 'Primary Email', email: 'Connect your Gmail in Settings' },
    },
    defaultSubject: 'Quick Question for {{name}} at {{company}}',
    defaultBody: `Hi {{name}},

I hope this message finds you well!

I came across {{company}} and was genuinely impressed by the work you're doing. I wanted to reach out because I believe there might be a great opportunity for us to connect.

A bit about me:
• [Your key credential or achievement]
• [Relevant experience or skill]
• [What makes you unique]

I'd love to learn more about what you're working on and explore if there's a fit.

Would you be open to a brief 15-minute call this week?

Looking forward to hearing from you!

Best regards,
[Your Name]
[Your Title/Position]
[Your Phone Number]
[Your Email]`,
    defaultFollowUp: `Hi {{name}},

Just wanted to bump this to the top of your inbox!

I know things get busy, but I'd still love the chance to connect and learn more about {{company}}.

No pressure at all — just let me know if you'd be open to a quick chat.

Thanks!
[Your Name]`,
    defaultResumePath: '',
}

// Export the active configuration
export const TEMPLATE_CONFIG = isPersonalUse ? PERSONAL_CONFIG : CUSTOMER_CONFIG

// Export individual values for easy access
export const SENDER_OPTIONS = TEMPLATE_CONFIG.senderOptions
export const DEFAULT_SUBJECT = TEMPLATE_CONFIG.defaultSubject
export const DEFAULT_BODY = TEMPLATE_CONFIG.defaultBody
export const DEFAULT_FOLLOWUP = TEMPLATE_CONFIG.defaultFollowUp
export const DEFAULT_RESUME_PATH = TEMPLATE_CONFIG.defaultResumePath

