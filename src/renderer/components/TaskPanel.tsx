import React, { useState } from 'react';

interface Task {
  id: string;
  content: string;
  completed: boolean;
  subtasks?: Task[];
}

interface TaskPanelProps {
  onGenerateTasks: (input: string) => Promise<Task[]>;
  isLoading: boolean;
}

/**
 * 任务面板组件
 * 支持 AI 生成任务拆解
 */
const TaskPanel: React.FC<TaskPanelProps> = ({ onGenerateTasks, isLoading }) => {
  const [input, setInput] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);

  // 生成任务
  const handleGenerate = async () => {
    if (!input.trim() || isLoading) return;

    try {
      const generatedTasks = await onGenerateTasks(input);
      setTasks(generatedTasks);
      setInput('');
    } catch (error) {
      console.error('Failed to generate tasks:', error);
    }
  };

  // 切换任务完成状态
  const toggleTask = (taskId: string) => {
    setTasks((prevTasks) =>
      prevTasks.map((task) =>
        task.id === taskId
          ? { ...task, completed: !task.completed }
          : task
      )
    );
  };

  // 清空所有任务
  const clearTasks = () => {
    setTasks([]);
  };

  // 计算完成进度
  const completedCount = tasks.filter((t) => t.completed).length;
  const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <h3>任务清单</h3>
        {tasks.length > 0 && (
          <button className="clear-btn" onClick={clearTasks}>
            清空
          </button>
        )}
      </div>

      {/* 输入区域 */}
      <div className="task-input-area">
        <textarea
          className="task-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的任务，AI 将帮你拆解..."
          rows={3}
        />
        <button
          className="generate-btn"
          onClick={handleGenerate}
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? '生成中...' : 'AI 拆解'}
        </button>
      </div>

      {/* 进度条 */}
      {tasks.length > 0 && (
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
          <span className="progress-text">
            {completedCount}/{tasks.length} 完成
          </span>
        </div>
      )}

      {/* 任务列表 */}
      <div className="task-list">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`task-item ${task.completed ? 'completed' : ''}`}
            onClick={() => toggleTask(task.id)}
          >
            <div className="task-checkbox">
              {task.completed ? '✓' : '○'}
            </div>
            <span className="task-content">{task.content}</span>
          </div>
        ))}

        {tasks.length === 0 && (
          <div className="empty-state">
            输入任务描述，AI 将自动拆解为可执行步骤
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskPanel;
