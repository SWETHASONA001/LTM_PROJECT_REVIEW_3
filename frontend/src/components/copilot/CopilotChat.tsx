import clsx from 'clsx';
import { ArrowUpRight, Bot, ClipboardCheck, Loader2, Send, ShieldAlert, User, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { localAnswer, SUGGESTED_QUESTIONS } from '../../lib/copilotEngine';
import { backend, useBackendStatus } from '../../services/api';
import { ensureConversation, useCopilotStore, useUiStore, type CopilotMessage } from '../../store/appStores';

export function useCopilotStatus() {
  const [status] = useBackendStatus();
  const llm = status.state === 'online' && status.health.capabilities.llm;
  return { status, llm };
}

export function ConnectionBanner({ compact }: { compact?: boolean }) {
  const { status, llm } = useCopilotStatus();
  const text = llm
    ? 'Connected to backend LLM agent.'
    : status.state === 'standalone'
      ? 'LLM provider not connected — running in local tool mode.'
      : status.state === 'online'
        ? 'Backend online, but no LLM provider is configured — local tool mode.'
        : status.state === 'checking'
          ? 'Checking backend…'
          : 'Backend unreachable — local tool mode.';
  return (
    <div className={clsx('flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-snug', llm ? 'border-[#c4e6d7] bg-energy-soft text-[#0b5a45]' : 'border-line bg-subtle text-ink-2')}>
      <span className={clsx('mt-1 h-2 w-2 shrink-0 rounded-full', llm ? 'bg-ok' : 'bg-warn')} />
      <span>
        {text}
        {!llm && !compact && ' Answers come from deterministic project tools (datasets, wake model, optimizer, dispatch), not a language model. Unsupported questions are declined rather than guessed.'}
      </span>
    </div>
  );
}

export function CopilotChat({ compact }: { compact?: boolean }) {
  const conversations = useCopilotStore((s) => s.conversations);
  const activeId = useCopilotStore((s) => s.activeId);
  const append = useCopilotStore((s) => s.append);
  const setContext = useCopilotStore((s) => s.setContext);
  const draft = useUiStore((s) => s.copilotDraft);
  const clearDraft = useUiStore((s) => s.clearDraft);
  const { llm } = useCopilotStatus();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const conv = conversations.find((c) => c.id === activeId);

  useEffect(() => {
    if (draft) {
      setInput(draft);
      clearDraft();
    }
  }, [draft, clearDraft]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [conv?.messages.length, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const id = ensureConversation();
    const c = useCopilotStore.getState().conversations.find((x) => x.id === id)!;
    append(id, { role: 'user', content: q });
    setInput('');
    setBusy(true);
    try {
      if (llm) {
        try {
          const r = await backend.copilot({ conversation_id: id, message: q, context: c.context });
          append(id, { role: 'assistant', content: r.answer, references: r.references, tools: r.tool_calls, mode: 'backend-llm' });
          return;
        } catch {
          /* fall through to local tools, clearly labeled */
        }
      }
      const a = await localAnswer(q, c.context);
      if (a.context) setContext(id, a.context);
      const { context: _ctx, ...msg } = a;
      void _ctx;
      append(id, { role: 'assistant', ...msg });
    } catch (e) {
      append(id, { role: 'assistant', content: `A tool failed while answering: ${e instanceof Error ? e.message : String(e)}. No result was produced.`, mode: 'local-tools' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-1 py-3 scroll-thin" aria-live="polite">
        {!conv || conv.messages.length === 0 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-white">
                <Bot size={20} />
              </div>
              <div>
                <div className="text-[15px] font-semibold">AeroHydro Engineering Copilot</div>
                <div className="text-[12.5px] text-muted">Grounded in project data, models and scenarios.</div>
              </div>
            </div>
            <ConnectionBanner compact={compact} />
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTED_QUESTIONS.slice(0, compact ? 6 : 12).map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-[12.5px] text-ink-2 hover:border-line-strong hover:bg-subtle">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          conv.messages.map((m) => <MessageView key={m.id} m={m} />)
        )}
        {busy && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 size={14} className="animate-spin" /> Running tools…
          </div>
        )}
      </div>
      <form
        className="mt-2 flex items-end gap-2 rounded-xl border border-line bg-surface p-2 focus-within:border-energy"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={compact ? 1 : 2}
          placeholder="Ask about turbines, wakes, layouts, hydrogen…"
          aria-label="Message the copilot"
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] outline-none placeholder:text-faint"
        />
        <button type="submit" disabled={!input.trim() || busy} aria-label="Send" className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-white disabled:opacity-40">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items?: string[]; tone: 'fact' | 'assume' | 'rec' }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className={clsx('mb-1 text-[11px] font-semibold uppercase tracking-wide', tone === 'fact' ? 'text-prov-observed' : tone === 'assume' ? 'text-prov-assumption' : 'text-energy')}>{title}</div>
      <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] leading-relaxed text-ink-2">
        {items.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
    </div>
  );
}

function MessageView({ m }: { m: CopilotMessage }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-[13.5px] text-white">{m.content}</div>
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2">
          <User size={14} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-white">
        <Bot size={14} />
      </div>
      <div className="min-w-0 max-w-[92%] flex-1 space-y-2.5 rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-3">
        <p className="text-[13.5px] leading-relaxed text-ink">{m.content}</p>
        <Section title="Facts from data & models" items={m.facts} tone="fact" />
        <Section title="Assumptions" items={m.assumptions} tone="assume" />
        <Section title="Recommendations" items={m.recommendations} tone="rec" />
        {m.instruction && (
          <div className="rounded-xl border-2 border-dashed border-[#f0dcb8] bg-warn-soft/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[#6b4105]">
              <ClipboardCheck size={15} /> Draft operator instruction · {m.instruction.turbine}
              <span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-warn">Not executed</span>
            </div>
            <dl className="space-y-1 text-[12.5px]">
              {(
                [
                  ['Proposed change', m.instruction.change],
                  ['Reason', m.instruction.reason],
                  ['Expected modeled effect', m.instruction.expectedEffect],
                  ['Confidence', m.instruction.confidence],
                  ['Source', m.instruction.source],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[130px_1fr] gap-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[130px_1fr] gap-2">
                <dt className="text-muted">Constraints</dt>
                <dd className="text-ink">
                  <ul className="list-disc pl-4">
                    {m.instruction.constraints.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
            <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[#6b4105]">
              <ShieldAlert size={13} /> Decision support only. Requires authorized operator approval and a validated control-system integration. No command has been sent.
            </div>
          </div>
        )}
        {(m.references?.length || m.tools?.length) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
            {m.tools?.map((t) => (
              <span key={t.name + t.summary} className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2" title={t.summary}>
                <Wrench size={10} /> {t.name}
              </span>
            ))}
            {m.references?.map((r) =>
              r.href ? (
                <Link key={r.label} to={r.href} className="inline-flex items-center gap-0.5 rounded-md bg-wind-soft px-1.5 py-0.5 text-[11px] font-medium text-wind hover:underline" title={r.detail}>
                  {r.label} <ArrowUpRight size={11} />
                </Link>
              ) : (
                <span key={r.label} className="rounded-md bg-wind-soft px-1.5 py-0.5 text-[11px] font-medium text-wind" title={r.detail}>
                  {r.label}
                </span>
              ),
            )}
            <span className="ml-auto text-[10.5px] text-faint">{m.mode === 'backend-llm' ? 'backend LLM' : 'local tool mode'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
