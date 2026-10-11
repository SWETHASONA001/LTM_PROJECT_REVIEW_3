import clsx from 'clsx';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { ConnectionBanner, CopilotChat } from '../components/copilot/CopilotChat';
import { Button, Card, IconButton, PageHeader } from '../components/ui/primitives';
import { date } from '../lib/format';
import { useCopilotStore, useUiStore } from '../store/appStores';

export default function CopilotPage() {
  const conversations = useCopilotStore((s) => s.conversations);
  const activeId = useCopilotStore((s) => s.activeId);
  const select = useCopilotStore((s) => s.select);
  const remove = useCopilotStore((s) => s.remove);
  const newConversation = useCopilotStore((s) => s.newConversation);
  const setFloating = useUiStore((s) => s.setCopilot);
  useEffect(() => setFloating(false), [setFloating]);

  return (
    <div>
      <PageHeader
        eyebrow="Assist"
        title="AI Engineering Copilot"
        description="Ask engineering questions about the turbines, wakes, layouts, hydro resource and hydrogen scenarios. Every answer separates facts, assumptions and recommendations and cites the tool or dataset it used."
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => newConversation()}>
            New conversation
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card padded={false} className="h-fit">
          <div className="px-4 pb-2 pt-4 text-[13px] font-semibold">Conversations</div>
          {conversations.length === 0 ? (
            <p className="px-4 pb-4 text-[12.5px] text-muted">No conversations yet. Stored in this browser only.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto px-2 pb-2 scroll-thin">
              {conversations.map((c) => (
                <li key={c.id} className={clsx('group flex items-center gap-1 rounded-lg', c.id === activeId ? 'bg-energy-soft' : 'hover:bg-subtle')}>
                  <button onClick={() => select(c.id)} className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left">
                    <MessageSquare size={14} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">{c.title}</span>
                      <span className="block text-[11px] text-muted">
                        {c.messages.length} messages · {date(c.createdAt)}
                      </span>
                    </span>
                  </button>
                  <IconButton label="Delete conversation" onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                    <Trash2 size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line p-3">
            <ConnectionBanner compact />
          </div>
        </Card>
        <Card className="flex h-[calc(100vh-15rem)] min-h-[520px] flex-col">
          <CopilotChat />
        </Card>
      </div>
    </div>
  );
}
