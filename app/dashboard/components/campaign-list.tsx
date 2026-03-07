'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Users,
  Send,
  Calendar,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  Loader2,
  MoreVertical,
  Activity
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

interface Campaign {
  id: string
  name: string
  subject_template: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent'
  recipients_count: number
  sent_count: number
  created_at: string
}

const statusConfig = {
  draft: {
    icon: Pencil,
    label: 'Draft',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    pulse: false
  },
  scheduled: {
    icon: Clock,
    label: 'Scheduled',
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    pulse: false
  },
  sending: {
    icon: Loader2,
    label: 'Sending',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    pulse: true
  },
  sent: {
    icon: CheckCircle2,
    label: 'Completed',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    pulse: false
  },
}

export default function CampaignList({
  campaigns,
  onDelete,
}: {
  campaigns: Campaign[]
  onDelete: (id: string) => void
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {campaigns.map((campaign) => {
        const status = statusConfig[campaign.status] || statusConfig.draft
        const StatusIcon = status.icon

        // Calculate progress
        const total = campaign.recipients_count || 0
        const sent = campaign.sent_count || 0
        const progress = total > 0 ? (sent / total) * 100 : 0

        return (
          <div
            key={campaign.id}
            className="group glass-card rounded-xl p-5 relative overflow-hidden flex flex-col justify-between"
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div className="space-y-1 min-w-0 pr-2">
                <Link href={`/dashboard/campaigns/${campaign.id}`} className="block focus:outline-none">
                  <h3 className="font-bold text-lg leading-tight truncate text-foreground group-hover:text-primary transition-colors">
                    {campaign.name}
                  </h3>
                </Link>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  {new Date(campaign.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted/50 rounded-full">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <Link href={`/dashboard/campaigns/${campaign.id}`}>
                    <DropdownMenuItem className="cursor-pointer">
                      <Activity className="mr-2 h-4 w-4" />
                      View Analytics
                    </DropdownMenuItem>
                  </Link>
                  <Link href={`/dashboard/campaigns/${campaign.id}`}>
                    <DropdownMenuItem className="cursor-pointer">
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Details
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive cursor-pointer"
                    onClick={() => onDelete(campaign.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Content Middle */}
            <div className="space-y-4 mb-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={`font-medium border-0 px-2.5 py-0.5 rounded-full ${status.className} ${status.pulse ? 'animate-pulse' : ''}`}>
                  <StatusIcon className={`h-3 w-3 mr-1.5 ${campaign.status === 'sending' ? 'animate-spin' : ''}`} />
                  {status.label}
                </Badge>
              </div>

              {/* Progress Bar (Visual Sparkline) */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span className="font-medium text-foreground">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-1.5 bg-muted" />
                <div className="flex justify-between text-[10px] text-muted-foreground pt-1">
                  <span>{sent} sent</span>
                  <span>{total} total</span>
                </div>
              </div>
            </div>

            {/* Footer / Actions */}
            <div className="pt-4 border-t border-border/40 flex justify-between items-center text-xs text-muted-foreground mt-auto">
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="truncate max-w-[150px] italic opacity-80">
                  {campaign.subject_template || 'No subject'}
                </span>
              </div>

              <Link
                href={`/dashboard/campaigns/${campaign.id}`}
                className="text-primary font-medium hover:underline flex items-center"
              >
                Details
              </Link>
            </div>

            {/* Hover Decorator */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mr-12 -mt-12 group-hover:bg-primary/10 transition-colors duration-500" />
          </div>
        )
      })}
    </div>
  )
}
