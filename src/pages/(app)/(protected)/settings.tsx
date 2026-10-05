/**
 * Example gated page. Reached at /settings — no auth logic lives here
 * because (protected)/_layout.tsx already wraps the subtree in <AuthGate>.
 */

import { signOut, useUser } from 'deepspace'
import { Button } from '@/components/ui'
import { AppearanceSetting } from '@/components/AppearanceSetting'

export default function SettingsPage() {
  const { user } = useUser()

  return (
    // No background on page wrappers — pages render into whatever the app's
    // (app)/_layout provides (a plain background, or a raised panel), so they
    // stay transparent and inherit it.
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-display text-4xl leading-tight">Settings</h1>

        <section className="mt-10 border-t border-ink pt-6">
          <h2 className="font-display text-2xl">Your account</h2>

          <dl className="mt-4 space-y-3 text-[15px]">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="text-foreground">{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>

          <Button variant="outline" className="mt-6" onClick={() => signOut()}>
            Sign out
          </Button>
        </section>

        <section className="mt-10 border-t border-ink pt-6">
          <h2 className="font-display text-2xl">Appearance</h2>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Light is the default. Dark is saved in this browser.
          </p>
          <div className="mt-4">
            <AppearanceSetting />
          </div>
        </section>
      </div>
    </div>
  )
}
