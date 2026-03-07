'use client'

import React, { useState, useRef, useEffect } from 'react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { CheckCircle2, ChevronRight, FileText, Send, Settings2, Upload, X, Loader2, Mail } from 'lucide-react'
import {
  DEFAULT_SUBJECT,
  DEFAULT_BODY,
  DEFAULT_FOLLOWUP,
} from '@/lib/config/templates'

interface GmailAccount {
  id: string
  email_address: string
  created_at: string
}

interface CreateCampaignModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateCampaign: (campaign: any) => void
}

const STEPS = [
  { id: 1, name: 'Details', icon: Settings2 },
  { id: 2, name: 'Content', icon: FileText },
  { id: 3, name: 'Review', icon: CheckCircle2 },
]

export default function CreateCampaignModal({
  open,
  onOpenChange,
  onCreateCampaign,
}: CreateCampaignModalProps) {
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)

  // Gmail accounts
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  // Form State
  const [name, setName] = useState('')
  const [senderEmail, setSenderEmail] = useState<string>('')
  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [resumePath, setResumePath] = useState('')
  const [resumeFileName, setResumeFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [body, setBody] = useState(DEFAULT_BODY)
  const [followUpTemplate, setFollowUpTemplate] = useState(DEFAULT_FOLLOWUP)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch connected Gmail accounts when modal opens
  useEffect(() => {
    if (open) {
      setLoadingAccounts(true)
      fetch('/api/gmail/credentials')
        .then(res => res.json())
        .then((accounts: GmailAccount[]) => {
          setGmailAccounts(accounts)
          if (accounts.length > 0 && !senderEmail) {
            setSenderEmail(accounts[0].email_address)
          }
        })
        .catch(err => console.error('Failed to fetch Gmail accounts:', err))
        .finally(() => setLoadingAccounts(false))
    }
  }, [open])

  const handleFileUpload = async (file: File) => {
    if (file.type !== 'application/pdf') {
      alert('Only PDF files are allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File too large (max 5MB)')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('resume', file)

      const response = await fetch('/api/upload-resume', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        setResumePath(data.path)
        setResumeFileName(data.fileName)
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to upload resume')
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload resume')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          subject,
          body,
          followUpTemplate,
          resume_storage_path: resumePath || null,
          sender_email: senderEmail,
        }),
      })

      if (response.ok) {
        const newCampaign = await response.json()
        onCreateCampaign(newCampaign)
        onOpenChange(false)
        resetForm()
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

  const resetForm = () => {
    setStep(1)
    setName('')
    setSubject(DEFAULT_SUBJECT)
    setBody(DEFAULT_BODY)
    setFollowUpTemplate(DEFAULT_FOLLOWUP)
    setResumePath('')
    setResumeFileName('')
    setSenderEmail(gmailAccounts[0]?.email_address || '')
  }

  const nextStep = () => setStep(step + 1)
  const prevStep = () => setStep(step - 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header with Steps */}
        <div className="px-6 py-4 border-b border-border bg-muted/20">
          <DialogTitle className="text-xl mb-4">Create New Campaign</DialogTitle>
          <div className="flex items-center justify-between px-8 relative">
            {/* Progress Bar Background */}
            <div className="absolute left-0 top-1/2 w-full h-0.5 bg-border -z-10" />

            {STEPS.map((s) => {
              const isActive = s.id === step
              const isCompleted = s.id < step
              const Icon = s.icon

              return (
                <div key={s.id} className="flex flex-col items-center gap-2 bg-background px-4 z-10">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${isActive ? 'border-primary bg-primary text-primary-foreground' :
                    isCompleted ? 'border-primary bg-background text-primary' :
                      'border-muted py-2 bg-background text-muted-foreground'
                    }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className={`text-xs font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                    {s.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="grid gap-2">
                <Label htmlFor="name">Campaign Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Q1 Engineering Outreach"
                  className="text-lg"
                  autoFocus
                />
              </div>

              <div className="grid gap-3">
                <Label>Send From Account</Label>
                {loadingAccounts ? (
                  <div className="flex items-center gap-2 p-4 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading accounts...</span>
                  </div>
                ) : gmailAccounts.length === 0 ? (
                  <div className="p-4 rounded-md border border-dashed border-muted-foreground/25 text-center">
                    <Mail className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No Gmail account connected.</p>
                    <p className="text-xs text-muted-foreground">Go to Settings to connect your Gmail.</p>
                  </div>
                ) : (
                  <RadioGroup
                    value={senderEmail}
                    onValueChange={(value) => setSenderEmail(value)}
                    className={`grid gap-4 ${gmailAccounts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
                  >
                    {gmailAccounts.map((account) => (
                      <div key={account.id}>
                        <RadioGroupItem value={account.email_address} id={`sender-${account.id}`} className="peer sr-only" />
                        <Label
                          htmlFor={`sender-${account.id}`}
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                        >
                          <Mail className="w-5 h-5 mb-1 text-muted-foreground" />
                          <span className="text-sm font-medium">{account.email_address}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </div>

              <div className="grid gap-2">
                <Label>Resume (PDF)</Label>
                {resumeFileName ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">{resumeFileName}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => { setResumePath(''); setResumeFileName('') }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${uploading ? 'border-primary/50 bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'}`}
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileUpload(file)
                        e.target.value = ''
                      }}
                    />
                    {uploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <p className="text-sm text-muted-foreground">Uploading...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="w-8 h-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          <span className="text-primary font-medium">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-muted-foreground">PDF only, up to 5MB</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="grid gap-2">
                <Label htmlFor="subject">Subject Line</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject..."
                  className="font-medium"
                />
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>Variables:</span>
                  <code className="bg-muted px-1 rounded">{'{{name}}'}</code>
                  <code className="bg-muted px-1 rounded">{'{{company}}'}</code>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="body">Email Body</Label>
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="h-48 font-light"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="followup">Auto Follow-up</Label>
                <Textarea
                  id="followup"
                  value={followUpTemplate}
                  onChange={(e) => setFollowUpTemplate(e.target.value)}
                  className="h-32 text-sm text-muted-foreground focus:text-foreground transition-colors"
                />
                <p className="text-xs text-muted-foreground">Sent automatically if no reply received.</p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="bg-muted/30 p-4 rounded-lg space-y-3 border border-border">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campaign</span>
                  <p className="text-lg font-medium">{name || 'Untitled Campaign'}</p>
                </div>
                <div className="flex justify-between">
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sender</span>
                    <p className="text-sm">{senderEmail || 'Not selected'}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resume</span>
                    <p className="text-sm truncate max-w-[200px]">
                      {resumeFileName ? (
                        <span className="flex items-center gap-1 justify-end">
                          <FileText className="w-3 h-3 text-primary" />
                          {resumeFileName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview</span>
                <div className="border border-border rounded-md p-4 bg-background">
                  <p className="text-sm font-semibold mb-2 border-b border-border pb-2">Subject: {subject}</p>
                  <p className="text-sm whitespace-pre-wrap">{body}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/20 flex justify-between">
          {step > 1 ? (
            <Button variant="outline" onClick={prevStep} disabled={loading}>
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < 3 ? (
            <Button onClick={nextStep} disabled={!name || !senderEmail}>
              Next <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading} className="px-8">
              {loading ? 'Creating...' : 'Launch Campaign'}
              {!loading && <Send className="w-4 h-4 ml-2" />}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
