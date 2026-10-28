import type { ReactNode, SVGProps } from 'react';

export type UiIconName = 'sparkles' | 'layers' | 'book' | 'check' | 'chevronRight' | 'chevronLeft' | 'plus' | 'search' | 'shield' | 'close' | 'edit' | 'archive' | 'copy' | 'eye' | 'info' | 'alert' | 'filter' | 'list' | 'checkCircle';

const drawings: Record<UiIconName, ReactNode> = {
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16ZM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2Z"/></>,
  layers: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4v5"/></>,
  book: <><path d="M4 5.5C7 4 10 4.5 12 6v14c-2-1.5-5-2-8-.5V5.5ZM20 5.5c-3-1.5-6-1-8 .5v14c2-1.5 5-2 8-.5V5.5Z"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  checkCircle: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  chevronRight: <path d="m9 18 6-6-6-6"/>,
  chevronLeft: <path d="m15 18-6-6 6-6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/></>,
  shield: <><path d="M12 2 20 5v6c0 5-3.5 8-8 11-4.5-3-8-6-8-11V5l8-3Z"/><path d="m9 12 2 2 4-4"/></>,
  close: <path d="M6 6 18 18M18 6 6 18"/>,
  edit: <><path d="m15 5 4 4M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 13h4"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  eye: <><path d="M2.5 12S6 6.5 12 6.5s9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></>,
  alert: <><path d="M10.3 4.4 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  filter: <><path d="M3 5h18M6 12h12M9 19h6"/></>,
  list: <><path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 5h.01M3 12h.01M3 19h.01"/></>,
};

export function UiIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: UiIconName }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{drawings[name]}</svg>;
}
