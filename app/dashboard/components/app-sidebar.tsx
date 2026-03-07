'use client'

import * as React from 'react'
import {
    LayoutDashboard,
    Mail,
    Settings,
    Sparkles,
    User,
    BarChart3
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
        title: 'Gmail Settings',
        url: '/dashboard/settings',
        icon: Settings,
    },
]

export function AppSidebar({ user, ...props }: { user: any } & React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname()
    const initials = user?.email ? user.email.substring(0, 2).toUpperCase() : 'U'

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
                                                <item.icon className={isActive ? "text-primary" : "text-muted-foreground"} />
                                                <span>{item.title}</span>
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
