import { useLearningData } from "../hooks/useLearningData";
import LearningTitleBar from "../components/learning/LearningTitleBar";
import StatusStrip from "../components/learning/StatusStrip";
import RuleCard from "../components/learning/RuleCard";
import DomainBreakdown from "../components/learning/DomainBreakdown";
import RunHistory from "../components/learning/RunHistory";

function LearningPanel() {
  const {
    settings,
    rules,
    runs,
    observationCount,
    unanalyzedCount,
    topTools,
    sparkline,
    analyzing,
    loading,
    updateSettings,
    triggerAnalysis,
    deleteRule,
  } = useLearningData();

  const handleToggleEnabled = (on: boolean) => {
    updateSettings({ ...settings, enabled: on });
  };

  if (loading) {
    return (
      <div className="learning-app">
        <LearningTitleBar
          enabled={settings.enabled}
          settings={settings}
          onToggleEnabled={handleToggleEnabled}
          onUpdateSettings={updateSettings}
        />
        <div className="learning-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="learning-app">
      <LearningTitleBar
        enabled={settings.enabled}
        settings={settings}
        onToggleEnabled={handleToggleEnabled}
        onUpdateSettings={updateSettings}
      />
      <div className="learning-content">
        <StatusStrip
          observationCount={observationCount}
          unanalyzedCount={unanalyzedCount}
          topTools={topTools}
          sparkline={sparkline}
          lastRun={runs[0]}
          analyzing={analyzing}
          onAnalyze={triggerAnalysis}
        />

        <div className="learning-section">
          <div className="learning-section-header">
            LEARNED RULES
            <span className="learning-section-count">
              {rules.length} rule{rules.length !== 1 ? "s" : ""}
            </span>
          </div>
          {rules.length === 0 ? (
            <div className="learning-empty">
              No rules learned yet. Run an analysis to get started.
            </div>
          ) : (
            <>
              {rules.map((rule) => (
                <RuleCard key={rule.name} rule={rule} onDelete={deleteRule} />
              ))}
              <DomainBreakdown rules={rules} />
            </>
          )}
        </div>

        <RunHistory runs={runs} />
      </div>
    </div>
  );
}

export default LearningPanel;
