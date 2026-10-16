'use client'

import * as React from 'react'
import {
    LayoutDashboard,
    Mail,
    Settings,
    Sparkles,
    User,
    BarChart3,
    ScanSearch,
    UserSearch,
    Trash2,
    Briefcase,
    KanbanSquare,
    Inbox,
    ListChecks
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

// Menu items.
const items = [
    {
        title: 'Dashboard',
        url: '/dashboard',
        icon: LayoutDashboard,
    },
    {
        title: 'Campaigns',
        url: '/dashboard/campaigns',
        icon: Mail,
    },
    {
        title: 'Pipeline',
        url: '/dashboard/pipeline',
        icon: KanbanSquare,
    },
    {
        title: 'Replies',
        url: '/dashboard/replies',
        icon: Inbox,
    },
    {
        title: 'Hiring Now',
        url: '/dashboard/jobs',
        icon: Briefcase,
    },
    {
        title: 'Extract Emails',
        url: '/dashboard/extract',
        icon: ScanSearch,
    },
    {
        title: 'Find HR & Leaders',
        url: '/dashboard/find-contacts',
        icon: UserSearch,
    },
    {
        title: 'Inbox Cleanup',
        url: '/dashboard/cleanup',
        icon: Trash2,
    },
    {
        title: 'Setup',
        url: '/dashboard/setup',
        icon: ListChecks,
    },
    {
        title: 'Gmail Settings',
        url: '/dashboard/settings',
        icon: Settings,
    },
]

export function AppSidebar({ user, ...props }: { user: any } & React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname()
    const initials = user?.email ? user.email.substring(0, 2).toUpperCase() : 'U'
    const [setupErrors, setSetupErrors] = React.useState(0)

    // Red dot on "Setup" when a check needs fixing; fetched once per page load, failures ignored
    React.useEffect(() => {
        let cancelled = false
        fetch('/api/health', { cache: 'no-store' })
            .then((res) => (res.ok ? res.json() : null))
            .then((report) => {
                if (!cancelled && report?.summary) setSetupErrors(report.summary.error || 0)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [])

    return (
        <Sidebar collapsible="icon" {...props} className="border-r border-border/40 bg-sidebar/50 backdrop-blur-xl">
            <SidebarHeader className="py-2">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild className="hover:bg-sidebar-accent/50">
                            <Link href="/dashboard">
                                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-violet-500 text-primary-foreground shadow-lg shadow-primary/25">
                                    <Sparkles className="size-4" />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-bold text-foreground">EmailReach</span>
                                    <span className="truncate text-xs text-muted-foreground">Pro Workspace</span>
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Application</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => {
                                const isActive = pathname === item.url || (item.url !== '/dashboard' && pathname.startsWith(item.url))
                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isActive}
                                            className="transition-all duration-200 data-[active=true]:bg-primary/10 data-[active=true]:text-primary font-medium"
                                        >
                                            <Link href={item.url}>
                                                <span className="relative">
                                                    <item.icon className={`size-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                                                    {item.url === '/dashboard/setup' && setupErrors > 0 && (
                                                        <span className="absolute -right-1 -top-1 size-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
                                                    )}
                                                </span>
                                                <span>{item.title}</span>
                                                {item.url === '/dashboard/setup' && setupErrors > 0 && (
                                                    <span className="sr-only">({setupErrors} setup issue{setupErrors === 1 ? '' : 's'})</span>
                                                )}
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" className="hover:bg-sidebar-accent/50 transition-colors">
                            <Avatar className="h-8 w-8 rounded-lg border border-border">
                                <AvatarImage src={user?.user_metadata?.avatar_url} alt="User" />
                                <AvatarFallback className="rounded-lg bg-gradient-to-br from-indigo-100 to-indigo-50 text-indigo-700 dark:from-indigo-900 dark:to-indigo-950 dark:text-indigo-300 font-bold">
                                    {initials}
                                </AvatarFallback>
                            </Avatar>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">{user?.user_metadata?.full_name || user?.email?.split('@')[0]}</span>
                                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
