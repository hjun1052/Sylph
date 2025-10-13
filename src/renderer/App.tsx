import React, { useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Tab } from './types/tab';

const createEmptyTab = (): Tab => ({
  id: uuidv4(),
  title: 'New Tab',
  url: '',
  favicon: '',
  isActive: true,
  isLoading: false,
  isCrashed: false,
  canGoBack: false,
  canGoForward: false,
  history: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const App = () => {
  const [tabs, setTabs] = useState<Tab[]>([createEmptyTab()]);

  const activeTab = useMemo(() => tabs.find(tab => tab.isActive), [tabs]);

  const setActiveTab = (id: string) => {
    setTabs(prev =>
      prev.map(tab => ({
        ...tab,
        isActive: tab.id === id,
      })),
    );
  };

  const createTab = () => {
    const newTab = createEmptyTab();
    setTabs(prev => [
      ...prev.map(tab => ({ ...tab, isActive: false })),
      newTab,
    ]);
  };

  const closeTab = (id: string) => {
    setTabs(prev => {
      const filtered = prev.filter(tab => tab.id !== id);
      if (filtered.length === 0) {
        return [createEmptyTab()];
      }
      if (!filtered.some(tab => tab.isActive)) {
        filtered[filtered.length - 1] = {
          ...filtered[filtered.length - 1],
          isActive: true,
        };
      }
      return filtered;
    });
  };

  const updateActiveTabUrl = (url: string) => {
    setTabs(prev =>
      prev.map(tab =>
        tab.isActive
          ? {
              ...tab,
              url,
              title: url || 'New Tab',
              updatedAt: Date.now(),
            }
          : tab,
      ),
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="sidebar__brand">Sylph</div>
          <button className="sidebar__new-tab" onClick={createTab}>
            + 새 탭
          </button>
        </div>

        <div className="sidebar__section">
          <div className="sidebar__section-label">탭</div>
          <div className="sidebar__tab-list">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`sidebar__tab ${tab.isActive ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <div className="sidebar__tab-indicator" />
                <div className="sidebar__tab-content">
                  <div className="sidebar__tab-title">
                    {tab.title || 'New Tab'}
                  </div>
                  <div className="sidebar__tab-url">
                    {tab.url || 'about:blank'}
                  </div>
                </div>
                <button
                  className="sidebar__tab-close"
                  onClick={event => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ×
                </button>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main-area">
        <div className="main-toolbar">
          <input
            className="main-toolbar__input"
            placeholder="주소 또는 명령 입력…"
            value={activeTab?.url ?? ''}
            onChange={event => updateActiveTabUrl(event.target.value)}
          />
          <div className="main-toolbar__actions">
            <button className="main-toolbar__button" type="button">
              뒤로
            </button>
            <button className="main-toolbar__button" type="button">
              앞으로
            </button>
            <button className="main-toolbar__button" type="button">
              새로고침
            </button>
          </div>
        </div>
        <div className="browser-view">
          {activeTab && (
            <webview
              key={activeTab.id}
              src={activeTab.url || 'https://www.google.com'}
              allowpopups={true}
            />
          )}
        </div>
      </main>

      <aside className="ai-panel">
        <div className="ai-panel__header">
          <h2>AI Sylph</h2>
          <span className="ai-panel__status">beta</span>
        </div>
        <div className="ai-panel__body">
          <p>웹 페이지 요약과 질문 답변이 곧 여기에 표시됩니다.</p>
          <p>Sylph의 AI 도우미가 연결될 때까지 잠시만 기다려 주세요.</p>
        </div>
        <div className="ai-panel__composer">
          <textarea placeholder="현재 페이지에 대해 무엇이 궁금한가요?" />
          <button type="button">전송</button>
        </div>
      </aside>
    </div>
  );
};

export default App;
