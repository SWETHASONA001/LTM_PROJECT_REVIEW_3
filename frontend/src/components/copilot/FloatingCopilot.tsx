import { Bot, Maximize2, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCopilotStore, useUiStore } from '../../store/appStores';
import { IconButton } from '../ui/primitives';
import { CopilotChat } from './CopilotChat';

/** Floating copilot launcher + panel available on operational pages. */
export function FloatingCopilot() {
  const open = useUiStore((s) => s.copilotOpen);
  const setOpen = useUiStore((s) => s.setCopilot);
  const newConversation = useCopilotStore((s) => s.newConversation);
  return (
    <div className="no-print">
      {open && (
        <div className="card fixed bottom-20 right-4 z-[70] flex h-[min(640px,calc(100vh-7rem))] w-[min(440px,calc(100vw-2rem))] flex-col p-3 shadow-[var(--shadow-pop)]" role="dialog" aria-label="Engineering copilot">
          <div className="flex items-center gap-2 border-b border-line px-1 pb-2">
            <Bot size={16} className="text-energy" />
            <span className="text-[13.5px] font-semibold">Engineering Copilot</span>
            <div className="ml-auto flex gap-0.5">
              <IconButton label="New conversation" onClick={() => newConversation()}>
                <Plus size={15} />
              </IconButton>
              <Link to="/copilot" onClick={() => setOpen(false)} aria-label="Open full copilot" title="Open full copilot" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-subtle">
                <Maximize2 size={14} />
              </Link>
              <IconButton label="Close copilot" onClick={() => setOpen(false)}>
                <X size={15} />
              </IconButton>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CopilotChat compact />
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close engineering copilot' : 'Open engineering copilot'}
        className="fixed bottom-4 right-4 z-[70] flex h-12 items-center gap-2 rounded-full bg-ink pl-3.5 pr-4 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)] transition-transform hover:scale-[1.02]"
      >
        {open ? <X size={18} /> : <Bot size={18} />}
        <span className="hidden sm:inline">{open ? 'Close' : 'Copilot'}</span>
      </button>
    </div>
  );
}
