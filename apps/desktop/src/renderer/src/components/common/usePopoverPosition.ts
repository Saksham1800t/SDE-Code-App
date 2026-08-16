import { useEffect, useRef, useState } from 'react';

interface PopoverPosition {
  top: number;
  left: number;
}

interface UsePopoverPositionOptions {
  estimatedHeight: number;
  menuWidth?: number;
}

export function usePopoverPosition({ estimatedHeight, menuWidth = 160 }: UsePopoverPositionOptions) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<PopoverPosition>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < estimatedHeight + 8 && rect.top >= estimatedHeight + 8;
      const top = openUpward ? rect.top - estimatedHeight - 4 : rect.bottom + 4;
      setMenuPos({ top, left: Math.min(rect.left, window.innerWidth - menuWidth) });
    }
    setOpen((o) => !o);
  };

  return { open, setOpen, triggerRef, menuRef, menuPos, toggleOpen };
}
