import React from 'react';
import UiScaleFrame from './components/UiScaleFrame';
import imgAudioWave from './assets/figma/audio-wave.png';
import imgPlusMath from './assets/figma/plus.png';
import imgGemini from './assets/figma/gemini.png';
import imgMute from './assets/figma/mute.png';
import imgInnerBg from './assets/figma/inner-bg.png';
import imgNavAvatar from './assets/figma/nav-avatar.png';

const App: React.FC = () => (
  <div className="app-shell">
    <UiScaleFrame>
      <div className="window" data-name="Window" data-node-id="240:213">
        <div className="nav-bar" data-name="Navigation Bar" data-node-id="235:2089">
          <div className="nav-title" data-node-id="I235:2089;127:82612">
            FlowMate
          </div>
          <div className="nav-avatar" data-name="Icons - Avatar" data-node-id="I235:2089;127:82627">
            <img src={imgNavAvatar} alt="" />
          </div>
        </div>
        <div className="inner-window" data-name="内窗" data-node-id="262:219">
          <img className="inner-bg" src={imgInnerBg} alt="" />
          <div className="inner-gradient" aria-hidden="true" />
          <div className="left-pane" data-name="左侧" data-node-id="262:230">
            <div className="avatar-image" data-name="Gemini" data-node-id="262:231">
              <img src={imgGemini} alt="" />
            </div>
            <button className="mute-button" type="button" data-node-id="262:232">
              <span className="mute-button-bg glass-widget glass-widget--border glass-widget-surface" aria-hidden="true" />
              <span className="mute-icon">
                <img src={imgMute} alt="" />
              </span>
            </button>
          </div>
          <div className="right-pane" data-name="右侧" data-node-id="262:220">
            <p className="headline" data-node-id="262:229">
              让我来拆解你的任务吧～
            </p>
            <div className="voice-input glass-widget glass-widget--border glass-widget-surface" data-node-id="262:221">
              <button className="voice-plus" type="button" aria-label="Add">
                <img src={imgPlusMath} alt="" />
              </button>
              <p className="voice-placeholder" data-node-id="262:228">
                今天要完成什么呢？
              </p>
              <button className="voice-action" type="button" aria-label="Speak">
                <span className="voice-action-bg" aria-hidden="true" />
                <img src={imgAudioWave} alt="" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </UiScaleFrame>
  </div>
);

export default App;
