import { Compass } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { EmptyState } from '../components/ui/states';

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="card mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={<Compass size={18} />}
        title="Page not found"
        body={<>There is no view at <code className="rounded bg-subtle px-1">{pathname}</code>. Use the sidebar or search (Ctrl+K).</>}
        action={
          <Link to="/" className="inline-flex h-9 items-center rounded-lg bg-ink px-3 text-sm font-medium text-white">
            Go to overview
          </Link>
        }
      />
    </div>
  );
}
