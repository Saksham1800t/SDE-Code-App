import React, { useEffect, useRef } from 'react';
import './GitPanel.css';

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuGroup {
  items: MenuItem[];
}

interface GitMoreMenuProps {
  groups: MenuGroup[];
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

export const GitMoreMenu: React.FC<GitMoreMenuProps> = ({ groups, onClose, anchorRef }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
        (!anchorRef?.current || !anchorRef.current.contains(e.target as Node))) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  return (
    <div ref={ref} className="sde-git-more-menu">
      {groups.map((group, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <div className="sde-separator" />}
          {group.items.map((item, ii) => (
            <button
              key={ii}
              onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }}
              disabled={item.disabled}
              className={`sde-menu-item${item.danger ? ' sde-menu-item--danger' : ''}`}
            >
              {item.icon && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16 }}>{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};
