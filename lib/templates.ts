export interface TemplateVariable {
  key: string
  label: string
  description: string
}

export const AVAILABLE_VARIABLES: TemplateVariable[] = [
  {
    key: 'name',
    label: 'Recipient Name',
    description: 'First name of the recipient',
  },
  {
    key: 'company',
    label: 'Company',
    description: 'Company name of the recipient',
  },
  {
    key: 'role',
    label: 'Job Role',
    description: 'Job title of the recipient',
  },
  {
    key: 'email',
    label: 'Email Address',
    description: 'Email address of the recipient',
  },
]

export function personalizeTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, 'g')
    result = result.replace(regex, value || '')
  })

  return result
}

export function extractVariablesFromTemplate(template: string): string[] {
  const regex = /{{(\w+)}}/g
  const matches: string[] = []
  let match

  while ((match = regex.exec(template)) !== null) {
    if (!matches.includes(match[1])) {
      matches.push(match[1])
    }
  }

  return matches
}

export function validateTemplate(template: string): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!template || template.trim().length === 0) {
    errors.push('Template cannot be empty')
    return { isValid: false, errors }
  }

  // Check for unclosed variables
  const openBraces = (template.match(/{/g) || []).length
  const closeBraces = (template.match(/}/g) || []).length

  if (openBraces !== closeBraces) {
    errors.push('Template has unmatched braces')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

export function getDefaultTemplate(type: 'initial' | 'followup'): string {
  if (type === 'initial') {
    return `Hi {{name}},

I hope this email finds you well. I'm reaching out because I think {{company}} could benefit from our services.

I'd love to schedule a quick call to discuss how we can help.

Best regards,
Your Name`
  }

  return `Hi {{name}},

Just following up on my previous email. I wanted to make sure it didn't get lost in your inbox.

Are you open to a brief conversation about how we can help {{company}}?

Looking forward to hearing from you.

Best regards,
Your Name`
}
