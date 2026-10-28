'use client';

import { ChevronDown, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { headerCopy } from '@/content/navigation';

export function HeaderShell({ children }: { children: ReactNode }): ReactNode {
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function updateBorder(): void {
      headerRef.current?.setAttribute('data-scrolled', String(window.scrollY > 8));
    }

    updateBorder();
    window.addEventListener('scroll', updateBorder, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateBorder);
    };
  }, []);

  return <header className="site-header" ref={headerRef}>{children}</header>;
}

export function HeaderDropdown({ children, label }: { children: ReactNode; label: string }): ReactNode {
  const id = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusFirstRef = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (focusFirstRef.current) {
      panelRef.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus();
      focusFirstRef.current = false;
    }

    function dismissOutside(event: PointerEvent): void {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [open]);

  return (
    <div
      className="nav-panel-wrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      ref={wrapperRef}
    >
      <button
        aria-controls={`${id}-panel`}
        aria-expanded={open}
        className="nav-trigger"
        id={`${id}-trigger`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (open) panelRef.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus();
            else {
              focusFirstRef.current = true;
              setOpen(true);
            }
          }
        }}
        ref={triggerRef}
        type="button"
      >
        {label}
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      <div
        aria-labelledby={`${id}-trigger`}
        className="nav-panel"
        hidden={!open}
        id={`${id}-panel`}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) setOpen(false);
        }}
        ref={panelRef}
        role="region"
      >
        {children}
      </div>
    </div>
  );
}

export function MobileMenu({ children, logo }: { children: ReactNode; logo: ReactNode }): ReactNode {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1024px)');

    function closeOnDesktop(): void {
      if (desktop.matches) dialogRef.current?.close();
    }

    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [open]);

  return (
    <>
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={headerCopy.openMenu}
        className="button button-secondary icon-button menu-toggle"
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        type="button"
      >
        <Menu aria-hidden="true" size={21} />
      </button>
      <dialog
        aria-label={headerCopy.menuLabel}
        className="mobile-menu"
        id={id}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) dialogRef.current?.close();
        }}
        onClose={() => {
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'))
            .filter((control) => control.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        ref={dialogRef}
      >
        <div className="mobile-menu-header">
          {logo}
          <button
            aria-label={headerCopy.closeMenu}
            className="button button-secondary icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <X aria-hidden="true" size={21} />
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
