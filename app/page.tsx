import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, CheckCircle2, Mail, Zap, BarChart3, Shield } from 'lucide-react'

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Navigation */}
      <header className="px-4 lg:px-6 h-16 flex items-center border-b bg-background/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2 font-bold text-xl text-primary">
          <Mail className="h-6 w-6" />
          <span>EmailReach</span>
        </div>
        <nav className="ml-auto flex gap-4 sm:gap-6">
          <Link href="/auth/login" className="text-sm font-medium hover:text-primary transition-colors flex items-center">
            Login
          </Link>
          <Link href="/auth/signup">
            <Button size="sm">Get Started Free</Button>
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="w-full pt-12 md:pt-24 lg:pt-32 pb-6 md:pb-12 bg-gradient-to-b from-background via-purple-50/20 to-background dark:via-purple-950/20 overflow-hidden">
          <div className="container mx-auto px-4 md:px-6">
            <div className="flex flex-col items-center space-y-4 text-center mb-12">
              <div className="space-y-2">
                <div className="inline-block rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary mb-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  The Free Streak CRM Alternative
                </div>
                <h1 className="text-4xl font-extrabold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl bg-clip-text text-transparent bg-gradient-to-r from-foreground to-primary/80 pb-2 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                  Mass Email Outreach, <br className="hidden sm:inline" />
                  <span className="text-primary">Without the Monthly Fees</span>
                </h1>
                <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl dark:text-gray-400 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
                  Send personalized campaigns, automate follow-ups, and track results directly from your Gmail.
                  Unlimited contacts. Free forever.
                </p>
              </div>
              <div className="space-x-4 pt-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
                <Link href="/auth/signup">
                  <Button size="lg" className="h-12 px-8 text-lg shadow-lg hover:shadow-primary/30 transition-all hover:scale-105">
                    Start Sending for Free <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/#how-it-works">
                  <Button variant="outline" size="lg" className="h-12 px-8 text-lg">
                    How it Works
                  </Button>
                </Link>
              </div>
              <p className="text-xs text-muted-foreground pt-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-400">
                No credit card required · Open Source · Privacy Focused
              </p>
            </div>

            {/* Dashboard Mockup - Image */}
            <div className="flex justify-center items-center w-full">
              <div className="mx-auto max-w-6xl w-full transform perspective-1000 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500 relative">
                <div className="relative rounded-xl border bg-background/50 backdrop-blur-xl shadow-2xl overflow-hidden translate-y-4 hover:translate-y-0 transition-transform duration-1000 ease-in-out">
                  <img
                    src="/dashboard-mockup.png"
                    alt="EmailReach Dashboard"
                    className="w-full h-auto object-cover"
                  />
                  {/* Glossy Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none" />
                </div>
                {/* Glow Effect */}
                <div className="absolute inset-x-0 -bottom-20 h-40 bg-primary/20 blur-3xl -z-10" />
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="how-it-works" className="w-full py-12 md:py-24 lg:py-32 bg-secondary/30">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">Everything you need to scale</h2>
              <p className="mt-4 text-muted-foreground md:text-xl">Built for founders, recruiters, and sales teams.</p>
            </div>
            <div className="grid gap-10 sm:px-10 md:gap-16 md:grid-cols-3">
              <div className="space-y-4 glass-card p-8 rounded-3xl border border-border/50 hover:border-primary/30 transition-all hover:-translate-y-1 duration-300">
                <div className="inline-block p-4 rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 mb-2">
                  <Mail className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold">Personalized at Scale</h3>
                <p className="text-muted-foreground text-base leading-relaxed">
                  Start every conversation with a warm touch. Use liquid variables like <code>{'{firstName}'}</code> to personalize every single email.
                </p>
              </div>
              <div className="space-y-4 glass-card p-8 rounded-3xl border border-border/50 hover:border-primary/30 transition-all hover:-translate-y-1 duration-300">
                <div className="inline-block p-4 rounded-2xl bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 mb-2">
                  <Zap className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold">Automated Follow-ups</h3>
                <p className="text-muted-foreground text-base leading-relaxed">
                  70% of replies come from follow-ups. Schedule automatic chasers that stop sending once your lead replies.
                </p>
              </div>
              <div className="space-y-4 glass-card p-8 rounded-3xl border border-border/50 hover:border-primary/30 transition-all hover:-translate-y-1 duration-300">
                <div className="inline-block p-4 rounded-2xl bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 mb-2">
                  <BarChart3 className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold">Real-time Analytics</h3>
                <p className="text-muted-foreground text-base leading-relaxed">
                  Watch your dashboard light up. Track opens, clicks, and replies instantly to know what messaging works best.
                </p>
              </div>
            </div>
          </div>
        </section>

      </main>

      <footer className="w-full py-12 px-4 md:px-6 border-t bg-background">
        <div className="container mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2 font-bold text-xl">
                <Mail className="h-6 w-6 text-primary" />
                <span>EmailReach</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The open-initiative alternative to expensive email outreach tools.
                Designed for founders, by founders.
              </p>
              <div className="flex gap-4">
                <Link href="#" className="text-muted-foreground hover:text-primary transition-colors">
                  <span className="sr-only">Twitter</span>
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
                  </svg>
                </Link>
                <Link href="#" className="text-muted-foreground hover:text-primary transition-colors">
                  <span className="sr-only">GitHub</span>
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                </Link>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-primary transition-colors">Features</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Pricing</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Changelog</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Docs</Link></li>
              </ul>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-primary transition-colors">About</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Blog</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Careers</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Contact</Link></li>
              </ul>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Terms of Service</Link></li>
                <li><Link href="#" className="hover:text-primary transition-colors">Cookie Policy</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
            <p>© 2024 EmailReach. Open Source & Free Forever.</p>
            <div className="flex gap-4">
              <span>Made with ❤️ by Founders</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
