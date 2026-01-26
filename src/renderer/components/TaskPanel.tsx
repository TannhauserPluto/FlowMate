import React, { useState, useEffect } from 'react';

interface Task {
  id: string;
  content: string;
  completed: boolean;
}

interface TaskPanelProps {
  onGenerateTasks: (input: string) => Promise<Task[]>;
  isLoading: boolean;
  onAllTasksCompleted?: () => void;
}

/**
 * 任务面板组件
 * 支持 AI 任务拆解 (调用 /api/brain/decompose)
 */
const TaskPanel: React.FC<TaskPanelProps> = ({ 
  onGenerateTasks, 
  isLoading,
  onAllTasksCompleted,
}) => {
  const [input, setInput] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  // 检测所有任务完成
  useEffect(() => {
    if (tasks.length > 0 && tasks.every(t => t.completed)) {
      setShowSuccess(true);
      onAllTasksCompleted?.();
      setTimeout(() => setShowSuccess(false), 3000);
    }
  }, [tasks, onAllTasksCompleted]);

  // 生成任务
  const handleGenerate = async () => {
    if (!input.trim() || isLoading) return;

    try {
      const generatedTasks = await onGenerateTasks(input.trim());
      setTasks(generatedTasks);
      setInput('');
    } catch (error) {
      console.error('Failed to generate tasks:', error);
    }
  };

  // 键盘回车提交
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  // 切换任务完成状态
  const toggleTask = (taskId: string) => {
    setTasks((prevTasks) =>
      prevTasks.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      )
    );
  };

  // 清空所有任务
  const clearTasks = () => {
    setTasks([]);
    setShowSuccess(false);
  };

  // 计算完成进度
  const completedCount = tasks.filter((t) => t.completed).length;
  const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <h3>任务拆解</h3>
        {tasks.length > 0 && (
          <button className="clear-btn" onClick={clearTasks}>
            清空
          </button>
        )}
      </div>

      {/* 成功提示 */}
      {showSuccess && (
        <div className="success-toast">
          太棒了！所有任务都完成了！
        </div>
      )}

      {/* 输入区域 */}
      <div className="task-input-area">
        <textarea
          className="task-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的大任务，例如：写一份调研报告"
          rows={2}
          disabled={isLoading}
        />
        <button
          className="generate-btn"
          onClick={handleGenerate}
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? (
            <span className="loading-dots">
              <span>.</span><span>.</span><span>.</span>
            </span>
          ) : (
            'AI 拆解'
          )}
        </button>
      </div>

      {/* 进度条 */}
      {tasks.length > 0 && (
        <div className="progress-bar-container">
          <div 
            className={`progress-bar ${progress === 100 ? 'complete' : ''}`} 
            style={{ width: `${progress}%` }} 
          />
          <span className="progress-text">
            {completedCount}/{tasks.length} 完成
          </span>
        </div>
      )}

      {/* 任务列表 */}
      <div className="task-list">
        {tasks.map((task, index) => (
          <div
            key={task.id}
            className={`task-item ${task.completed ? 'completed' : ''}`}
            onClick={() => toggleTask(task.id)}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="task-number">{index + 1}</div>
            <div className="task-checkbox">
              {task.completed ? '✓' : '○'}
            </div>
            <span className="task-content">{task.content}</span>
          </div>
        ))}

        {tasks.length === 0 && !isLoading && (
          <div className="empty-state">
            输入任务描述，AI 将自动拆解为 3 个可执行步骤
          </div>
        )}

        {isLoading && tasks.length === 0 && (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <span>AI 正在拆解任务...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskPanel;
