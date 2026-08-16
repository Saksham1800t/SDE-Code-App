import React from 'react';
import { createPortal } from 'react-dom';
import { Clock, Trash2 } from 'lucide-react';
import { usePopoverPosition } from '../../common/usePopoverPosition';
import { relativeTime } from '../../../utils/relativeTime';

interface SavedConversation {
  id: string;
  project_id: string;
  title: string;
  messages: string;
  updated_at: number;
}

interface ChatHistoryProps {
  conversations: SavedConversation[];
  activeChatId: string | null;
  handleLoadChat: (chatId: string) => void;
  handleDeleteChat: (e: React.MouseEvent, chatId: string) => void;
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({
  conversations,
  activeChatId,
  handleLoadChat,
  handleDeleteChat,
}) => {
  const { open, setOpen, triggerRef, menuRef, menuPos, toggleOpen } = usePopoverPosition({
    estimatedHeight: Math.min(conversations.length, 6) * 42 + 8,
    menuWidth: 240,
  });

  if (conversations.length === 0) return null;

  return (
    <>
      <button ref={triggerRef} className="sde-header-icon-btn" onClick={toggleOpen} title="Chat history">
        <Clock size={13} />
      </button>

      {open && createPortal(
        <div ref={menuRef} className="sde-popover-menu sde-history-popover" style={{ top: menuPos.top, left: menuPos.left }}>
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`sde-history-item${c.id === activeChatId ? ' active' : ''}`}
              onClick={() => { handleLoadChat(c.id); setOpen(false); }}
            >
              <div className="sde-history-item-text">
                <span className="sde-history-item-title">{c.title}</span>
                <span className="sde-history-item-time">{relativeTime(c.updated_at)}</span>
              </div>
              <button
                className="sde-history-item-delete"
                onClick={(e) => handleDeleteChat(e, c.id)}
                title="Delete this chat"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};
