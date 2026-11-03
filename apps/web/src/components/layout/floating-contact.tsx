'use client';

import type { PublicSettings } from '@sv/contracts';
import { Headset, MessageCircle, MessageCircleMore, Phone, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { floatingContactCopy as copy } from '@/content/contact';
import { liveChatCopy } from '@/content/live-chat';
import type { ChatPanelProps } from '@/components/live-chat/chat-panel';

type ContactProps = Pick<PublicSettings['contact'], 'phoneDisplay' | 'phoneE164' | 'whatsappE164'>;

const actionSelector = [
  '.mobile-sticky-cta',
  '.booking-next',
  '.booking-card .button-primary',
  '.booking-card .address-glass',
  '.booking-card [role="radiogroup"]',
  'main button[type="submit"].button-primary',
].join(', ');

const maxLift = 160;

export function FloatingContact({ phoneDisplay, phoneE164, whatsappE164 }: ContactProps): ReactNode {
  const dockRef = useRef<HTMLElement>(null);
  const optionsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [Panel, setPanel] = useState<ComponentType<ChatPanelProps> | null>(null);
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [unread, setUnread] = useState(0);
  const openingRef = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const phoneHref = phoneE164 ? `tel:${phoneE164}` : null;
  const whatsappHref = whatsappE164 ? `https://wa.me/${whatsappE164.replace(/^\+/, '')}?text=${encodeURIComponent(copy.message)}` : null;

  useEffect(() => {
    if (!expanded) return undefined;
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !dockRef.current?.contains(event.target)) setExpanded(false);
    };
    const dismissWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setExpanded(false);
      launcherRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissWithKeyboard);
    };
  }, [expanded]);

  useEffect(() => {
    if (open) { wasOpen.current = true; return undefined; }
    if (!wasOpen.current) return undefined;
    let attempts = 0;
    let frame = 0;
    const restore = (): void => {
      const launcher = launcherRef.current;
      // Native close and viewport/collision updates can settle on separate frames.
      if (launcher && getComputedStyle(launcher).visibility === 'visible' && !document.querySelector('dialog[open]')) {
        launcher.focus({ preventScroll: true });
        if (document.activeElement === launcher) { wasOpen.current = false; return; }
      }
      attempts += 1;
      if (attempts < 60) frame = window.requestAnimationFrame(restore);
    };
    frame = window.requestAnimationFrame(restore);
    return () => { window.cancelAnimationFrame(frame); };
  }, [open]);

  async function openChat(): Promise<void> {
    if (Panel) { setExpanded(false); setOpen(true); return; }
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setLoadError(false);
    try {
      const module = await import('@/components/live-chat/chat-panel');
      setPanel(() => module.default);
      setExpanded(false);
      setOpen(true);
    } catch {
      setLoadError(true);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return undefined;
    let frame = 0;

    const position = (): void => {
      frame = 0;
      dock.dataset.suppressed = String(Boolean(document.querySelector('.consent-banner:not([hidden]), .mobile-menu[open]')));
      // Measure the untransformed container so every pass starts from its natural position.
      const base = dock.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      let lift = Math.max(0, base.bottom - viewportTop - viewportHeight + 12);
      const actions = Array.from(document.querySelectorAll(actionSelector))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportTop + viewportHeight)
        .sort((a, b) => b.bottom - a.bottom);

      for (const rect of actions) {
        const overlapsHorizontally = base.left < rect.right + 12 && base.right > rect.left - 12;
        const overlapsVertically = base.top - lift < rect.bottom + 12 && base.bottom - lift > rect.top - 12;
        if (overlapsHorizontally && overlapsVertically) lift = base.bottom - rect.top + 12;
      }

      const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? viewportTop;
      dock.style.setProperty('--contact-lift', `${String(Math.ceil(lift))}px`);
      dock.style.setProperty('--contact-options-height', `${String(Math.max(0, Math.floor(base.top - lift - Math.max(headerBottom, viewportTop) - 24)))}px`);
      // Clearing a sticky bar is a short hop; climbing over a whole form would leave the dock mid-screen over content, so it steps aside instead.
      dock.dataset.obstructed = String(lift > maxLift || base.top - lift < Math.max(headerBottom, viewportTop) + 12);
    };
    const schedule = (): void => {
      if (!frame) frame = window.requestAnimationFrame(position);
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(dock);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, { attributes: true, attributeFilter: ['hidden', 'open'], childList: true, subtree: true });
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    schedule();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [phoneE164, whatsappE164]);

  const contact = (
    <aside aria-label={copy.label} className="floating-contact" data-chat-open={open} onBlur={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
    }} ref={dockRef}>
      <div className="floating-contact-panel">
        <button aria-controls={optionsId} aria-expanded={expanded} aria-label={expanded ? copy.close : copy.open} className="floating-contact-launcher" onClick={() => { setExpanded((value) => !value); }} ref={launcherRef} title={copy.help} type="button">
          {expanded ? <X aria-hidden="true" size={25} /> : <Headset aria-hidden="true" size={25} />}
          {unread > 0 ? <span aria-label={liveChatCopy.unread(unread)} className="floating-contact-unread">{unread > 99 ? '99+' : unread}</span> : null}
        </button>
        <div className="floating-contact-options" hidden={!expanded} id={optionsId}>
        <p className="floating-contact-greeting">{copy.greeting}</p>
        {loadError ? <p className="floating-contact-error" role="alert">{liveChatCopy.moduleError}</p> : null}
        <div className="floating-contact-actions">
          <button aria-busy={opening} aria-expanded={open} aria-haspopup="dialog" aria-label={liveChatCopy.open} className="floating-chat" onClick={() => { void openChat(); }} type="button">
            <MessageCircleMore aria-hidden="true" size={25} strokeWidth={1.8} />
            <span className="floating-chat-label">{opening ? liveChatCopy.loadingPanel : liveChatCopy.label}</span>
          </button>
          {whatsappE164 ? (
            <a
              aria-label={copy.whatsappLabel}
              className="floating-whatsapp"
              href={whatsappHref ?? undefined}
              rel="noopener noreferrer"
              target="_blank"
              title={copy.whatsappLabel}
            >
              <span aria-hidden="true" className="floating-whatsapp-icon">
                <MessageCircle size={28} strokeWidth={1.8} />
                <Phone size={13} strokeWidth={2} />
              </span>
              <span>{copy.whatsapp}</span>
            </a>
          ) : null}
          {phoneE164 ? (
            <a
              aria-label={copy.callLabel(phoneDisplay ?? phoneE164)}
              className="floating-call"
              href={phoneHref ?? undefined}
              title={copy.callLabel(phoneDisplay ?? phoneE164)}
            >
              <Phone aria-hidden="true" size={23} strokeWidth={1.8} />
              <span>{copy.call}</span>
            </a>
          ) : null}
        </div>
        </div>
      </div>
    </aside>
  );

  return (
    <>
    {contact}
    {Panel ? <Panel onClose={() => { setOpen(false); }} onUnreadChange={setUnread} open={open} phoneHref={phoneHref} whatsappHref={whatsappHref} /> : null}
    </>
  );
}
