/**
 * Scroll a live editor node into `.document-editor-scroll`.
 * `Element.scrollIntoView` misses this scroller because the page shell is
 * `overflow-hidden`.
 */

const TOOLBAR_GAP_PX = 16;

export function getEditorScrollParent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.document-editor-scroll');
}

function connectedElement(node: Node | null | undefined): HTMLElement | null {
  if (!node) return null;
  const el = node instanceof HTMLElement ? node : node.parentElement;
  return el instanceof HTMLElement && el.isConnected ? el : null;
}

export function scrollEditorElementIntoView(
  el: HTMLElement,
  options?: { readonly block?: 'start' | 'center' },
): boolean {
  const scrollParent = getEditorScrollParent();
  if (!scrollParent) {
    el.scrollIntoView({
      block: options?.block ?? 'center',
      behavior: 'smooth',
      inline: 'nearest',
    });
    return true;
  }

  const parentRect = scrollParent.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const toolbar = document.querySelector<HTMLElement>('[data-document-editor-toolbar]');
  const toolbarOffset =
    toolbar && !scrollParent.contains(toolbar)
      ? TOOLBAR_GAP_PX
      : Math.ceil(toolbar?.getBoundingClientRect().height ?? 0) + TOOLBAR_GAP_PX;

  let delta = elRect.top - parentRect.top - toolbarOffset;
  if (options?.block === 'center' || options?.block == null) {
    delta = elRect.top - parentRect.top - scrollParent.clientHeight / 2 + elRect.height / 2;
  }
  scrollParent.scrollTo({
    top: Math.max(0, scrollParent.scrollTop + delta),
    behavior: 'smooth',
  });
  return true;
}

/** Resolve a ProseMirror position to a connected HTMLElement in the editor. */
export function elementAtEditorPos(
  view: { readonly domAtPos: (pos: number) => { readonly node: Node } },
  pos: number,
): HTMLElement | null {
  try {
    const { node } = view.domAtPos(pos);
    return connectedElement(node);
  } catch {
    return null;
  }
}
