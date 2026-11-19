'use client';
import React, { useCallback, useEffect, useRef } from 'react';
import { handlePasteContent, sanitizeHtml } from '@/lib/sanitize-html';

export interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number | string;
  className?: string;
  disabled?: boolean;
}

export function RichTextEditor({
  value = '',
  onChange,
  placeholder = 'Nhập hoặc dán nội dung văn bản tại đây…',
  minHeight = 280,
  className = '',
  disabled = false
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string>(value);

  // Sync external value changes into the contentEditable div
  useEffect(() => {
    if (!editorRef.current) return;
    const currentHtml = editorRef.current.innerHTML;
    // Don't overwrite if inner content is effectively the same as incoming value
    if (value !== lastEmittedRef.current) {
      const normalizedCurrent = sanitizeHtml(currentHtml);
      const normalizedIncoming = sanitizeHtml(value);
      if (normalizedCurrent !== normalizedIncoming) {
        editorRef.current.innerHTML = value;
        lastEmittedRef.current = value;
      }
    }
  }, [value]);

  const syncAndEmit = useCallback(() => {
    if (!editorRef.current) return;
    const raw = editorRef.current.innerHTML;
    const isEmpty =
      !raw ||
      raw === '<br>' ||
      raw === '<p><br></p>' ||
      raw.trim() === '' ||
      raw === '<div><br></div>';
    const sanitized = isEmpty ? '' : sanitizeHtml(raw);
    lastEmittedRef.current = sanitized;
    onChange?.(sanitized);
  }, [onChange]);

  const runCommand = (command: string, arg?: string) => {
    if (disabled || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, arg);
    syncAndEmit();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();

    const htmlData = e.clipboardData.getData('text/html');
    const textData = e.clipboardData.getData('text/plain');
    const result = handlePasteContent({ html: htmlData, text: textData });

    if (result.type === 'html') {
      document.execCommand('insertHTML', false, result.content);
    } else {
      document.execCommand('insertText', false, result.content);
    }
    syncAndEmit();
  };

  return (
    <div
      className={`rich-text-editor-container ${className}`}
      style={{
        border: '1px solid rgb(167 189 222 / 0.47)',
        borderRadius: 12,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Toolbar */}
      <div
        className="rich-text-toolbar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          padding: '6px 8px',
          background: 'rgb(243 247 252 / 0.85)',
          borderBottom: '1px solid rgb(172 195 222 / 0.35)'
        }}
        role="toolbar"
        aria-label="Định dạng văn bản"
      >
        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.8rem', fontWeight: 700 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('bold')}
          title="In đậm (Bold)"
          disabled={disabled}
        >
          B
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.8rem', fontStyle: 'italic' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('italic')}
          title="In nghiêng (Italic)"
          disabled={disabled}
        >
          I
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.8rem', textDecoration: 'underline' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('underline')}
          title="Gạch chân (Underline)"
          disabled={disabled}
        >
          U
        </button>

        <span style={{ width: 1, height: 18, background: '#cbd5e1', margin: '0 3px' }} />

        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.78rem' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('formatBlock', '<h2>')}
          title="Tiêu đề lớn (H2)"
          disabled={disabled}
        >
          H2
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.78rem' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('formatBlock', '<h3>')}
          title="Tiêu đề vừa (H3)"
          disabled={disabled}
        >
          H3
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.78rem' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('formatBlock', '<p>')}
          title="Đoạn văn chuẩn (Paragraph)"
          disabled={disabled}
        >
          Đoạn
        </button>

        <span style={{ width: 1, height: 18, background: '#cbd5e1', margin: '0 3px' }} />

        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.78rem' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('insertUnorderedList')}
          title="Danh sách dấu đầu dòng"
          disabled={disabled}
        >
          • Danh sách
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.78rem' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('insertOrderedList')}
          title="Danh sách số thứ tự"
          disabled={disabled}
        >
          1. Danh sách
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          style={{ padding: '3px 8px', minHeight: 28, fontSize: '0.78rem' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('formatBlock', '<blockquote>')}
          title="Trích dẫn (Blockquote)"
          disabled={disabled}
        >
          Trích dẫn
        </button>
      </div>

      {/* ContentEditable Area */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={syncAndEmit}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        className="package-source-area rich-text-editable"
        style={{
          minHeight,
          padding: '12px 14px',
          outline: 'none',
          lineHeight: 1.65,
          fontSize: '0.96rem',
          overflowY: 'auto'
        }}
      />
    </div>
  );
}
