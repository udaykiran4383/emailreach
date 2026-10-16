import { describe, expect, it } from 'vitest'
import { applyPattern, inferPattern } from '@/lib/email/email-patterns'
import { classifyRole, dedupeAndSort, extractPeopleFromHtml, isConfirmed, normalizeCompanyInput, splitName } from '@/lib/email/people-finder'

describe('email patterns', () => {
  it('applies patterns with accent folding and punctuation removal', () => {
    expect(applyPattern('{first}.{last}', 'José', "O'Neil")).toBe('jose.oneil')
    expect(applyPattern('{f}{last}', 'Ana', 'Pérez-Gómez')).toBe('aperezgomez')
    expect(applyPattern('{first}{l}', 'Raj', '')).toBeNull()
  })

  it('infers a pattern from known emails, needing 2 matches for single-name patterns', () => {
    expect(inferPattern([
      { email: 'jdoe@x.com', first: 'John', last: 'Doe' },
      { email: 'asmith@x.com', first: 'Alice', last: 'Smith' },
    ])).toBe('{f}{last}')
    expect(inferPattern([{ email: 'john@x.com', first: 'John', last: 'Doe' }])).toBeNull()
    expect(inferPattern([])).toBeNull()
  })
})

describe('people extraction', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","founder":[{"@type":"Person","name":"Priya Sharma","jobTitle":"Co-founder & CEO"}]}</script></head><body>
<nav><a href="/about">About Us</a><strong>Our Team</strong></nav>
<div class="card"><h3>Rahul Verma</h3><p>Chief Technology Officer</p></div>
<div class="card"><h4>Anita Desai</h4><span>Head of Talent Acquisition</span></div>
<div class="card"><h4>Karthik N. Rao</h4><p class="role">Engineering Manager, Platform</p></div>
<div class="card"><h3>Read More</h3><p>Lead engineer stories</p></div>
<ul><li>Meera Iyer – Principal Engineer</li><li>Contact Us, Sales Director</li></ul>
<h2>Open Roles</h2><p>Senior Engineer</p>
</body></html>`
  const people = extractPeopleFromHtml(html, 'https://x.com/team')
  const byName = Object.fromEntries(people.map((p) => [p.name, p.role]))

  it('finds people from JSON-LD, team cards and "Name – Title" lines', () => {
    expect(byName['Priya Sharma']).toBe('ceo')
    expect(byName['Rahul Verma']).toBe('cto')
    expect(byName['Anita Desai']).toBe('hr')
    expect(byName['Karthik N. Rao']).toBe('tech_lead')
    expect(byName['Meera Iyer']).toBe('tech_lead')
  })

  it('ignores navigation and headings that are not people', () => {
    const names = people.map((p) => p.name)
    for (const junk of ['Our Team', 'Read More', 'Open Roles', 'Contact Us', 'About Us']) {
      expect(names).not.toContain(junk)
    }
  })

  it('splits names', () => {
    expect(splitName('Dr. Priya Sharma')).toMatchObject({ firstName: 'Priya', lastName: 'Sharma' })
    expect(splitName('Madonna')).toBeNull()
    expect(splitName('Team 2026')).toBeNull()
  })
})

describe('classifyRole', () => {
  it.each([
    ['Founder', 'ceo'],
    ['Managing Director', 'ceo'],
    ['Co-founder & CTO', 'cto'],
    ['VP of Engineering', 'cto'],
    ['Talent Partner', 'hr'],
    ['HR Manager', 'hr'],
    ['Staff Software Engineer', 'tech_lead'],
    ['Marketing Lead', 'other'],
  ])('%s → %s', (title, role) => {
    expect(classifyRole(title)).toBe(role)
  })
})

describe('normalizeCompanyInput', () => {
  it('normalizes URLs and refuses social networks', () => {
    expect(normalizeCompanyInput('https://www.acme.co.in/about')).toMatchObject({ domain: 'acme.co.in' })
    expect(normalizeCompanyInput('linkedin.com/company/acme')).toHaveProperty('error')
    expect(normalizeCompanyInput('   ')).toEqual({ error: 'Empty company' })
  })
})

describe('dedupeAndSort', () => {
  it('merges duplicates preferring website data and sorts by role then confidence', () => {
    const base = { name: '', firstName: '', lastName: '', title: '', company: 'X', domain: 'x.com' }
    const out = dedupeAndSort([
      { ...base, email: 'A@x.com', role: 'other', source: 'pattern', confidence: 50 },
      { ...base, email: 'a@x.com', name: 'Al B', firstName: 'Al', lastName: 'B', title: 'CTO', role: 'cto', source: 'website', confidence: 90 },
      { ...base, email: 'c@x.com', title: 'CEO', role: 'ceo', source: 'hunter', confidence: 70 },
    ] as any)
    expect(out.map((c) => [c.email, c.role, c.source])).toEqual([
      ['c@x.com', 'ceo', 'hunter'],
      ['a@x.com', 'cto', 'website'],
    ])
  })
})

describe('isConfirmed', () => {
  it('only trusts positively confirmed mailboxes', () => {
    expect(isConfirmed({ status: 'safe', details: { confirmed: true } })).toBe(true)
    expect(isConfirmed({ status: 'safe', details: { mxRecords: [] } })).toBe(false)
    expect(isConfirmed({ status: 'safe', details: { smtp: { status: 'safe', catchAll: false } } })).toBe(true)
    expect(isConfirmed({ status: 'safe', details: { smtp: { status: 'safe', catchAll: true } } })).toBe(false)
    expect(isConfirmed({ status: 'risky', details: { confirmed: true, catchAll: true } } as any)).toBe(false)
  })
})
