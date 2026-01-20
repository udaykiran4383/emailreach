'use client'

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const DEFAULT_BODY = `Hi {{name}},

I hope you’re doing well.

My name is Udaykiran, a final-year B.Tech student at IIT Bombay, graduating in May 2026. I’m reaching out to explore SDE-1 / Backend / Full Stack / Frontend opportunities at {{company}}.

I’ve built and shipped production systems across multiple internships, including:

- High-throughput backend APIs
- AI-integrated pipelines using LLMs
- Scalable full-stack applications using Next.js, Node.js, Python, AWS, and Docker

I’m keen to work on strong engineering teams that value ownership and impact.

If there are any current or upcoming openings, I’d love to apply. If not, I’d really appreciate it if you could point me to the right person/team to contact or advise on potential referral opportunities.

I’ve attached my resume below for reference.

Thank you for your time and guidance.

Best regards,
Udaykiran
Contact: +91 9381406475
LinkedIn: www.linkedin.com/in/uday-yennampelly`

const DEFAULT_RESUME_PATH = '/Users/uday/Downloads/email-outreach-app/uday_iitb.pdf'

const DEFAULT_SUBJECT = 'SDE / Backend / Full Stack Opportunities at {{company}} | Udaykiran (IIT Bombay \'26)'

const DEFAULT_FOLLOWUP = `Hi {{name}},

Just following up on my earlier email regarding SDE / Backend / Full Stack roles at {{company}}.

I’d appreciate any update, or guidance on the right person/team to contact if applicable.

Re-sharing my resume for convenience.

Thanks for your time.

Best,
Udaykiran
Contact: +91 9381406475
LinkedIn: www.linkedin.com/in/uday-yennampelly`

interface CreateCampaignModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateCampaign: (campaign: any) => void
}

export default function CreateCampaignModal({
  open,
  onOpenChange,
  onCreateCampaign,
}: CreateCampaignModalProps) {
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [body, setBody] = useState(DEFAULT_BODY)
  const [followUpTemplate, setFollowUpTemplate] = useState(DEFAULT_FOLLOWUP)
  const [resumePath, setResumePath] = useState(DEFAULT_RESUME_PATH)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          subject,
          body,
          followUpTemplate,
          resume_storage_path: resumePath,
        }),
      })

      if (response.ok) {
        const newCampaign = await response.json()
        onCreateCampaign(newCampaign)
        onOpenChange(false)
        setName('')
        setSubject('')
        setBody(DEFAULT_BODY)
        setFollowUpTemplate(DEFAULT_FOLLOWUP)
        setResumePath(DEFAULT_RESUME_PATH)
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to create campaign')
      }
    } catch (error) {
      console.error('Error creating campaign:', error)
      alert('Failed to create campaign')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Campaign Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Q1 Outreach"
                required
                disabled={loading}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="subject">Email Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g., SDE Opportunity at {{company}} | Your Name"
                required
                disabled={loading}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="resumePath">Resume Path (Absolute)</Label>
              <Input
                id="resumePath"
                value={resumePath}
                onChange={(e) => setResumePath(e.target.value)}
                placeholder="/absolute/path/to/resume.pdf"
              />
              <p className="text-xs text-muted-foreground">Path to file on your local machine.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="body">Email Body Template</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hi {{name}}, ..."
                className="h-60"
                required
                disabled={loading}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="followUp">Follow-up Template (Auto-Reply)</Label>
              <Textarea
                id="followUp"
                value={followUpTemplate}
                onChange={(e) => setFollowUpTemplate(e.target.value)}
                placeholder="Hi {{name}}, checking in..."
                className="h-40"
                disabled={loading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Campaign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

