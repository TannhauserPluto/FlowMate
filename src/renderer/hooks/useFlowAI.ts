import { useState, useCallback, useRef } from 'react';

interface Task {
  id: string;
  content: string;
  completed: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  emotion?: string;
}

interface ChatHistory {
  user?: string;
  assistant?: string;
}

const API_BASE = 'http://127.0.0.1:8000/api';

/**
 * AI 交互钩子
 * 与 Python 后端 Brain API 通信
 */
export function useFlowAI() {
  const [isLoading, setIsLoading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  /**
   * 任务拆解 - 调用 /api/brain/decompose
   * 将大任务拆解为 3 个可执行步骤
   */
  const decomposeTasks = useCallback(async (task: string): Promise<Task[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/brain/decompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });

      if (!response.ok) {
        throw new Error('任务拆解失败');
      }

      const steps: string[] = await response.json();
      return steps.map((step, index) => ({
        id: `task-${Date.now()}-${index}`,
        content: step,
        completed: false,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setError(msg);
      // 返回默认任务
      return [
        { id: `task-${Date.now()}-0`, content: '打开相关软件', completed: false },
        { id: `task-${Date.now()}-1`, content: '新建工作文件', completed: false },
        { id: `task-${Date.now()}-2`, content: '写下第一行内容', completed: false },
      ];
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 闲聊 - 调用 /api/brain/chat
   * FlowMate 伴侣对话
   */
  const chat = useCallback(async (message: string): Promise<{ reply: string; emotion: string }> => {
    setIsChatLoading(true);
    setError(null);

    // 添加用户消息到界面
    const userMessage: ChatMessage = { role: 'user', content: message };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await fetch(`${API_BASE}/brain/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message,
          history: chatHistory.slice(-6), // 最近 6 轮对话
        }),
      });

      if (!response.ok) {
        throw new Error('聊天请求失败');
      }

      const data: { reply: string; emotion: string } = await response.json();

      // 添加助手回复到界面
      const assistantMessage: ChatMessage = { 
        role: 'assistant', 
        content: data.reply,
        emotion: data.emotion,
      };
      setMessages(prev => [...prev, assistantMessage]);

      // 更新历史记录
      setChatHistory(prev => [...prev, { user: message, assistant: data.reply }]);

      return data;
    } catch (err) {
      const fallbackReply = '我在这里陪着你，有什么需要帮忙的吗';
      const assistantMessage: ChatMessage = { 
        role: 'assistant', 
        content: fallbackReply,
        emotion: 'neutral',
      };
      setMessages(prev => [...prev, assistantMessage]);
      
      return { reply: fallbackReply, emotion: 'neutral' };
    } finally {
      setIsChatLoading(false);
    }
  }, [chatHistory]);

  /**
   * 清空聊天记录
   */
  const clearChat = useCallback(() => {
    setMessages([]);
    setChatHistory([]);
  }, []);

  /**
   * 兼容旧接口 - generateTasks
   */
  const generateTasks = decomposeTasks;

  /**
   * 兼容旧接口 - sendMessage
   */
  const sendMessage = useCallback(async (message: string): Promise<string | null> => {
    const result = await chat(message);
    return result.reply;
  }, [chat]);

  return {
    // 状态
    isLoading,
    isChatLoading,
    error,
    messages,
    chatHistory,
    
    // 任务拆解
    decomposeTasks,
    generateTasks, // 兼容旧接口
    
    // 闲聊
    chat,
    sendMessage, // 兼容旧接口
    clearChat,
  };
}
