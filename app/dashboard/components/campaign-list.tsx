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
  FileText,
  ChevronRight,
  MoreVertical
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

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
    variant: 'secondary' as const,
    icon: FileText,
    label: 'Draft',
    className: 'bg-slate-100 text-slate-700 hover:bg-slate-100/80',
  },
  scheduled: {
    variant: 'default' as const,
    icon: Clock,
    label: 'Scheduled',
    className: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100/80 border-indigo-200',
  },
  sending: {
    variant: 'default' as const,
    icon: Loader2,
    label: 'Sending',
    className: 'bg-amber-100 text-amber-700 hover:bg-amber-100/80 border-amber-200',
  },
  sent: {
    variant: 'outline' as const,
    icon: CheckCircle2,
    label: 'Sent',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50/80',
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
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {campaigns.map((campaign, index) => {
        const status = statusConfig[campaign.status] || statusConfig.draft
        const StatusIcon = status.icon

        return (
          <Card key={campaign.id} className="group transition-all duration-200 hover:shadow-md border-border/60">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-5 px-5">
              <div className="flex flex-col gap-1.5 min-w-0 pr-4">
                <Link href={`/dashboard/campaigns/${campaign.id}`} className="block">
                  <h3 className="font-semibold leading-none tracking-tight truncate hover:text-primary transition-colors">
                    {campaign.name}
                  </h3>
                </Link>
                <Badge variant="outline" className={`w-fit gap-1 font-normal ${status.className}`}>
                  <StatusIcon className={`h-3 w-3 ${campaign.status === 'sending' ? 'animate-spin' : ''}`} />
                  {status.label}
                </Badge>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2 text-muted-foreground">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <Link href={`/dashboard/campaigns/${campaign.id}`}>
                    <DropdownMenuItem>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Campaign
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDelete(campaign.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="px-5 py-2">
              <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                <span className="font-medium text-foreground/80 mr-1">Subject:</span> {campaign.subject_template}
              </p>
            </CardContent>
            <CardFooter className="px-5 pb-5 pt-4 text-xs text-muted-foreground border-t bg-muted/20 flex items-center justify-between mt-2">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5" title="Recipients">
                  <Users className="h-3.5 w-3.5" />
                  <span>{campaign.recipients_count}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Sent Emails">
                  <Send className="h-3.5 w-3.5" />
                  <span>{campaign.sent_count}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  {new Date(campaign.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
