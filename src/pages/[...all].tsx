import { Link } from 'react-router-dom'
import { APP_NAME } from '../constants'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center text-center px-4">
      <title>{`Not found · ${APP_NAME}`}</title>
      <h1 className="font-display text-6xl text-foreground mb-2">404</h1>
      <p className="text-muted-foreground mb-6">Page not found</p>
      <Link
        to="/home"
        className="rounded-sm border border-ink bg-ink px-5 py-2.5 text-[15px] font-medium text-background hover:bg-ink/85 transition-colors"
      >
        Go home
      </Link>
    </div>
  )
}
