import React, { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  emotion?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => Promise<{ reply: string; emotion: string }>;
  isLoading: boolean;
  onClearChat: () => void;
}

/**
 * 聊天面板组件
 * 支持 FlowMate 伴侣闲聊 (调用 /api/brain/chat)
 */
const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  isLoading,
  onClearChat,
}) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const message = input.trim();
    setInput('');
    
    await onSendMessage(message);
  };

  // 键盘回车发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 快捷问题
  const quickQuestions = [
    '我有点累了',
    '我卡住了',
    '我做完了！',
  ];

  const handleQuickQuestion = (question: string) => {
    setInput(question);
    inputRef.current?.focus();
  };

  // 获取情绪对应的样式类
  const getEmotionClass = (emotion?: string) => {
    switch (emotion) {
      case 'happy': return 'emotion-happy';
      case 'tired': return 'emotion-tired';
      case 'need_help': return 'emotion-help';
      case 'greeting': return 'emotion-greeting';
      default: return '';
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <h3>FlowMate</h3>
        {messages.length > 0 && (
          <button className="clear-btn" onClick={onClearChat}>
            清空
          </button>
        )}
      </div>

      {/* 消息列表 */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-avatar">FM</div>
            <div className="welcome-text">
              <p>你好，我是 FlowMate</p>
              <p className="welcome-sub">你的专注伙伴，有什么可以帮你的？</p>
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`chat-message ${msg.role} ${getEmotionClass(msg.emotion)}`}
          >
            {msg.role === 'assistant' && (
              <div className="message-avatar">FM</div>
            )}
            <div className="message-content">
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message assistant loading">
            <div className="message-avatar">FM</div>
            <div className="message-content">
              <span className="typing-indicator">
                <span></span><span></span><span></span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 快捷问题 */}
      {messages.length === 0 && (
        <div className="quick-questions">
          {quickQuestions.map((q, index) => (
            <button
              key={index}
              className="quick-btn"
              onClick={() => handleQuickQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* 输入区域 */}
      <div className="chat-input-area">
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="和 FlowMate 聊聊..."
          disabled={isLoading}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
};

export default ChatPanel;
