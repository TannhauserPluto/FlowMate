import { useState, useCallback } from 'react';

interface Task {
  id: string;
  content: string;
  completed: boolean;
  subtasks?: Task[];
}

interface AIResponse {
  action: 'speak' | 'animate' | 'task' | 'break';
  content: string;
  audioUrl?: string;
}

const API_BASE = 'http://127.0.0.1:8000/api';

/**
 * AI 交互钩子
 * 与 Python 后端通信，获取 AI 响应
 */
export function useFlowAI() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 生成任务拆解
   */
  const generateTasks = useCallback(async (input: string): Promise<Task[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/interaction/generate-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_description: input }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate tasks');
      }

      const data = await response.json();
      return data.tasks.map((task: string, index: number) => ({
        id: `task-${Date.now()}-${index}`,
        content: task,
        completed: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 获取 AI 响应 (闲聊/鼓励/提醒)
   */
  const getAIResponse = useCallback(async (context: {
    flowState: string;
    workDuration: number;
    fatigueLevel: number;
  }): Promise<AIResponse | null> => {
    try {
      const response = await fetch(`${API_BASE}/interaction/get-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      return await response.json();
    } catch (err) {
      console.error('AI response error:', err);
      return null;
    }
  }, []);

  /**
   * 语音合成
   */
  const synthesizeSpeech = useCallback(async (text: string): Promise<string | null> => {
    try {
      const response = await fetch(`${API_BASE}/interaction/synthesize-speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Failed to synthesize speech');
      }

      const data = await response.json();
      return data.audio_url;
    } catch (err) {
      console.error('Speech synthesis error:', err);
      return null;
    }
  }, []);

  /**
   * 发送用户消息
   */
  const sendMessage = useCallback(async (message: string): Promise<string | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/interaction/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      return data.reply;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    error,
    generateTasks,
    getAIResponse,
    synthesizeSpeech,
    sendMessage,
  };
}
