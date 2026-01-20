'use client'

import { Mail, AtSign, FileText, Lightbulb } from 'lucide-react'

export default function EmailPreview({
  subject,
  body,
}: {
  subject: string
  body: string
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Preview Phone */}
      <div className="lg:col-span-2">
        <div className="relative max-w-md mx-auto">
          {/* Phone frame with gradient */}
          <div className="absolute inset-0 gradient-primary rounded-[2.5rem] opacity-20 blur-xl" />
          <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-[2.5rem] p-3 shadow-2xl">
            {/* Phone screen */}
            <div className="bg-white rounded-[2rem] overflow-hidden">
              {/* Status bar */}
              <div className="bg-gray-100 px-6 py-2 flex items-center justify-between text-xs text-gray-500">
                <span>9:41</span>
                <div className="flex gap-1">
                  <div className="w-4 h-2 bg-gray-400 rounded-sm" />
                  <div className="w-4 h-2 bg-gray-400 rounded-sm" />
                </div>
              </div>

              {/* Email content */}
              <div className="bg-gray-50 p-4">
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  {/* Email Header */}
                  <div className="border-b border-gray-100 p-4">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                      <Mail className="w-3 h-3" />
                      <span>From: your@email.com</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                      <AtSign className="w-3 h-3" />
                      <span>To: recipient@example.com</span>
                    </div>
                    <h3 className="font-semibold text-gray-900 text-sm leading-tight">{subject}</h3>
                  </div>

                  {/* Email Body */}
                  <div className="p-4 text-sm text-gray-700 whitespace-pre-wrap break-words max-h-80 overflow-y-auto leading-relaxed">
                    {body}
                  </div>
                </div>
              </div>

              {/* Home indicator */}
              <div className="bg-white py-2 flex justify-center">
                <div className="w-24 h-1 bg-gray-300 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Email Details */}
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-xl p-6 card-hover">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg gradient-primary">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-semibold text-foreground">Email Details</h3>
          </div>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground mb-1">Subject Line</p>
              <p className="text-sm font-medium text-foreground">{subject}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">Characters</p>
                <p className="text-lg font-semibold text-foreground">{body.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">Lines</p>
                <p className="text-lg font-semibold text-foreground">{body.split('\n').length}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-xl p-4">
          <div className="flex gap-3">
            <div className="p-1.5 rounded-lg bg-primary/20 h-fit">
              <Lightbulb className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Personalization Tips</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Use <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono text-[10px]">{'{name}'}</code>,{' '}
                <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono text-[10px]">{'{email}'}</code>, and{' '}
                <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono text-[10px]">{'{company}'}</code> to personalize your emails.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
