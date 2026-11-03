'use client';

import { CHAT_MESSAGE_MAX_LENGTH, CHAT_POLL_INTERVAL_MS, CHAT_UNREAD_POLL_INTERVAL_MS, type ChatConversation, type ChatMessage, type ChatSendRequest, type ChatSessionResponse } from '@sv/contracts';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronUp, MessageCircleMore, Phone, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { liveChatCopy as copy } from '@/content/live-chat';
import { chatQueryKeys as keys } from '@/lib/query-keys';
import { ChatRequestError, getChatMessages, getChatSession, markChatRead, sendChatMessage, startChatSession } from './api';
import styles from './chat-panel.module.css';
import { useChatSound } from './use-chat-sound';

export interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  onUnreadChange: (count: number) => void;
  phoneHref: string | null;
  whatsappHref: string | null;
}

interface Timeline {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  cursor: string | null;
  olderCursor: string | null;
  hasOlder: boolean;
}

function appendMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const ids = new Set(current.map((message) => message.id));
  return [...current, ...incoming.filter((message) => !ids.has(message.id))];
}

function failureText(error: unknown, fallback: string): string {
  if (error instanceof ChatRequestError && error.status === 429) return copy.rateLimit;
  if (error instanceof ChatRequestError && error.status === 401) return copy.sessionError;
  return fallback;
}

const messageTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' });

function Conversation({ open, onClose, onUnreadChange, phoneHref, whatsappHref }: ChatPanelProps): ReactNode {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const historyHeight = useRef<number | null>(null);
  const pending = useRef<ChatSendRequest | null>(null);
  const submitting = useRef(false);
  const markedId = useRef<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const titleId = useId();
  const sound = useChatSound();
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [readError, setReadError] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [foreground, setForeground] = useState(true);
  const session = useQuery({
    queryKey: keys.session, queryFn: ({ signal }) => getChatSession(signal), retry: false,
    refetchInterval: (query) => !open && query.state.data?.conversation ? CHAT_UNREAD_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const conversation = session.data?.conversation;
  useEffect(() => {
    if (!session.isSuccess) return;
    const nextId = conversation?.id ?? null;
    if (sessionId.current && sessionId.current !== nextId) {
      client.removeQueries({ queryKey: keys.messages });
      markedId.current = null;
      pending.current = null;
      setReadError(false);
    }
    sessionId.current = nextId;
    sound.setConversation(nextId);
  }, [conversation?.id, session.isSuccess, client, sound.setConversation]);
  useEffect(() => {
    const update = (): void => { setForeground(document.visibilityState === 'visible'); };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { document.removeEventListener('visibilitychange', update); };
  }, []);
  const timeline = useQuery({
    queryKey: keys.messages,
    enabled: foreground && Boolean(conversation),
    retry: false, refetchInterval: open ? CHAT_POLL_INTERVAL_MS : CHAT_UNREAD_POLL_INTERVAL_MS, refetchIntervalInBackground: false,
    queryFn: async ({ signal }): Promise<Timeline> => {
      const soundEpoch = sound.requestEpoch();
      const previous = client.getQueryData<Timeline>(keys.messages);
      const page = await getChatMessages(previous?.cursor ? { after: previous.cursor } : undefined, signal);
      sound.observe(page.conversation?.id ?? null, page.messages, Boolean(previous?.cursor) && page.hasMore, soundEpoch);
      const current = client.getQueryData<Timeline>(keys.messages);
      const confirmedIndex = current?.cursor ? current.messages.findIndex((message) => message.id === current.cursor) : -1;
      const confirmed = current?.messages.slice(0, confirmedIndex + 1) ?? [];
      const acknowledged = current?.messages.slice(confirmedIndex + 1) ?? [];
      return {
        conversation: page.conversation,
        // A send acknowledgement can arrive after an unseen reply. Only GET
        // advances the cursor and establishes their canonical server order.
        messages: appendMessages(appendMessages(confirmed, page.messages), acknowledged),
        cursor: page.cursor ?? current?.cursor ?? null,
        olderCursor: current?.olderCursor ?? page.olderCursor,
        hasOlder: current?.hasOlder ?? page.hasMore,
      };
    },
  });
  const messages = timeline.data?.messages ?? [];
  const read = useMutation({
    mutationFn: markChatRead, retry: false,
    onSuccess: (response) => {
      setReadError(false);
      client.setQueryData(keys.session, response);
    },
    onError: () => { setReadError(true); markedId.current = null; },
  });
  const send = useMutation({
    retry: false,
    onSettled: () => { submitting.current = false; },
    mutationFn: async (input: ChatSendRequest) => {
      await client.cancelQueries({ queryKey: keys.messages });
      if (!client.getQueryData<ChatSessionResponse>(keys.session)?.conversation) {
        const started = await startChatSession();
        // Another tab may have started the cookie session since the initial GET.
        // Establish its real empty/history baseline before sending, so the first
        // reply rings without treating saved cross-tab history as a new reply.
        const soundEpoch = sound.requestEpoch();
        const baseline = await getChatMessages();
        if (!baseline.conversation || baseline.conversation.id !== started.conversation?.id) throw new ChatRequestError(401);
        sound.setConversation(baseline.conversation.id);
        sound.observe(baseline.conversation.id, baseline.messages, false, soundEpoch);
        client.setQueryData<Timeline>(keys.messages, {
          conversation: baseline.conversation,
          messages: baseline.messages,
          cursor: baseline.cursor,
          olderCursor: baseline.olderCursor,
          hasOlder: baseline.hasMore,
        });
        client.setQueryData(keys.session, started);
      }
      return sendChatMessage(input);
    },
    onSuccess: (response) => {
      client.setQueryData(keys.session, { conversation: response.conversation });
      client.setQueryData<Timeline>(keys.messages, (current) => ({
        conversation: response.conversation,
        messages: appendMessages(current?.messages ?? [], [response.message]),
        cursor: current?.cursor ?? null,
        olderCursor: current?.olderCursor ?? null,
        hasOlder: current?.hasOlder ?? false,
      }));
      pending.current = null;
      nearBottom.current = true;
      setBody('');
    },
    onError: (error) => {
      if (error instanceof ChatRequestError && error.status === 401) {
        client.setQueryData(keys.session, { conversation: null });
        client.removeQueries({ queryKey: keys.messages });
      }
    },
  });
  const earlier = useMutation({
    retry: false,
    mutationFn: async () => {
      const before = client.getQueryData<Timeline>(keys.messages)?.olderCursor;
      if (!before) throw new Error(copy.earlierError);
      await client.cancelQueries({ queryKey: keys.messages });
      return getChatMessages({ before });
    },
    onSuccess: (page) => {
      historyHeight.current = log.current?.scrollHeight ?? null;
      client.setQueryData<Timeline>(keys.messages, (current) => ({
        conversation: current?.conversation ?? page.conversation,
        messages: appendMessages(page.messages, current?.messages ?? []),
        cursor: current?.cursor ?? page.cursor,
        olderCursor: page.olderCursor,
        hasOlder: page.hasMore,
      }));
    },
  });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const resize = (): void => {
      element.style.setProperty('--chat-vh', `${String(window.visualViewport?.height ?? window.innerHeight)}px`);
      element.style.setProperty('--chat-top', `${String(window.visualViewport?.offsetTop ?? 0)}px`);
    };
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, [open]);

  useEffect(() => {
    onUnreadChange(open ? 0 : session.data?.conversation?.unreadCount ?? 0);
  }, [open, session.data?.conversation?.unreadCount, onUnreadChange]);

  useLayoutEffect(() => {
    const element = log.current;
    if (!element || !open) return;
    if (historyHeight.current !== null) {
      element.scrollTop += element.scrollHeight - historyHeight.current;
      historyHeight.current = null;
    } else if (nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages.length, open]);

  const latestAdminMessage = [...messages].reverse().find((message) => message.sender === 'ADMIN');
  useEffect(() => {
    if (!open || !latestAdminMessage || read.isPending || readError || markedId.current === latestAdminMessage.id) return;
    if (document.visibilityState !== 'visible' || !atBottom) return;
    markedId.current = latestAdminMessage.id;
    read.mutate(latestAdminMessage.id);
  }, [open, latestAdminMessage, read, readError, atBottom, foreground]);

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = body.trim();
    if (!text || submitting.current || send.isPending || session.isPending || session.isError) return;
    const customerName = name.trim();
    if (!pending.current || pending.current.body !== text || pending.current.customerName !== (customerName || undefined)) {
      pending.current = { clientMessageId: crypto.randomUUID(), body: text, ...(customerName && !conversation?.customerName && messages.length === 0 ? { customerName } : {}) };
    }
    submitting.current = true;
    send.mutate(pending.current);
  }

  const initialLoading = session.isPending || (Boolean(conversation) && timeline.isPending);
  const loadError = session.isError || timeline.isError;
  return (
    <dialog aria-labelledby={titleId} className={['live-chat-dialog', styles.dialog].join(' ')} onClose={onClose} ref={dialog}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <span aria-hidden="true" className={styles.avatar}><MessageCircleMore size={24} /></span>
          <div><h2 id={titleId}>{copy.title}</h2><p>{copy.subtitle}</p></div>
          <button aria-label={copy.close} className={styles.close} onClick={() => { dialog.current?.close(); }} type="button"><X aria-hidden="true" size={22} /></button>
        </header>
        <div className={styles.quickLinks}>
          <span>{copy.browserNote}</span>
          {whatsappHref ? <a href={whatsappHref} rel="noopener noreferrer" tabIndex={0} target="_blank">{copy.whatsapp}<span className="sr-only"> (opens in a new tab)</span></a> : null}
          {phoneHref ? <a href={phoneHref} tabIndex={0}><Phone aria-hidden="true" size={15} />{copy.call}</a> : null}
          <button aria-describedby={`${titleId}-sound`} aria-label={sound.phase === 'ready' ? copy.muteSound : copy.enableSound} aria-pressed={sound.phase === 'ready'} className={styles.sound} disabled={sound.phase === 'loading'} onClick={sound.toggle} type="button">
            {sound.phase === 'ready' ? <Volume2 aria-hidden="true" size={17} /> : <VolumeX aria-hidden="true" size={17} />}
            {sound.phase === 'ready' ? copy.soundOn : sound.phase === 'loading' ? copy.soundLoading : copy.soundOff}
          </button>
          <span className={styles.soundStatus} id={`${titleId}-sound`} role="status">{sound.phase === 'blocked' ? copy.soundBlocked : sound.phase === 'unarmed' ? copy.soundEnableHint : sound.phase === 'muted' ? copy.soundMuted : sound.phase === 'ready' ? copy.soundReady : copy.soundLoading}</span>
        </div>
        <div aria-label={copy.log} className={styles.messages} role="region" tabIndex={0} onScroll={() => {
          const element = log.current;
          if (element) {
            nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 56;
            setAtBottom(nearBottom.current);
          }
        }} ref={log}>
          {initialLoading ? <div aria-label={copy.loading} className={styles.skeleton} role="status"><span /><span /><span /></div> : null}
          {loadError ? <div className={styles.error} role="alert"><p>{failureText(session.error ?? timeline.error, copy.loadError)}</p><button onClick={() => { void session.refetch(); if (conversation) void timeline.refetch(); }} type="button">{copy.retry}</button></div> : null}
          {!initialLoading && !loadError && messages.length === 0 ? <div className={styles.welcome}><span aria-hidden="true">👋</span><h3>{copy.introduction}</h3><p>{copy.introductionBody}</p></div> : null}
          {timeline.data?.hasOlder ? <button className={styles.earlier} disabled={earlier.isPending} onClick={() => { earlier.mutate(); }} type="button"><ChevronUp aria-hidden="true" size={16} />{earlier.isPending ? copy.loadingEarlier : copy.earlier}</button> : null}
          {earlier.isError ? <p className={styles.error} role="alert">{copy.earlierError}</p> : null}
          <div aria-live="polite" aria-relevant="additions text" role="log">
            {messages.map((message) => <div className={[styles.message, message.sender === 'CUSTOMER' ? styles.outgoing : styles.incoming].join(' ')} key={message.id}>
              <span className={styles.sender}>{message.sender === 'CUSTOMER' ? copy.you : copy.team}</span>
              <p>{message.body}</p>
              <time dateTime={message.createdAt}>{messageTime.format(new Date(message.createdAt))}{message.sender === 'CUSTOMER' ? ` · ${copy.sent}` : ''}</time>
            </div>)}
          </div>
        </div>
        {readError ? <div className={styles.readError} role="status">{copy.readError} <button onClick={() => { setReadError(false); }} type="button">{copy.retryRead}</button></div> : null}
        <form className={styles.composer} onSubmit={submit}>
          {!conversation?.customerName && messages.length === 0 ? <label className={styles.name}>{copy.name}<input autoComplete="given-name" disabled={send.isPending} maxLength={80} onChange={(event) => { setName(event.target.value); }} value={name} /></label> : null}
          <div className={styles.inputRow}>
            <label className="sr-only" htmlFor={`${titleId}-message`}>{copy.message}</label>
            <textarea id={`${titleId}-message`} maxLength={CHAT_MESSAGE_MAX_LENGTH} onChange={(event) => { setBody(event.target.value); if (send.isError) send.reset(); }} placeholder={copy.placeholder} readOnly={send.isPending} rows={2} value={body} />
            <button aria-label={send.isPending ? copy.sending : copy.send} className={styles.send} disabled={!body.trim() || send.isPending || initialLoading || session.isError} type="submit"><ArrowUp aria-hidden="true" size={23} /></button>
          </div>
          {send.isError ? <p className={styles.error} role="alert">{failureText(send.error, copy.sendError)}</p> : null}
          <footer><span aria-live="polite">{send.isPending ? copy.sending : ''}</span><a href="/legal/privacy" tabIndex={0}>{copy.privacy}</a></footer>
        </form>
      </div>
    </dialog>
  );
}

export default function ChatPanel(props: ChatPanelProps): ReactNode {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 }, mutations: { retry: false } } }));
  return <QueryClientProvider client={client}><Conversation {...props} /></QueryClientProvider>;
}
