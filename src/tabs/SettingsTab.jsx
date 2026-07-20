import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';

/* 個人設定區（V63）：跟人走的工作環境調校，全部存 prefs（user_prefs 雲端同步）。
   四區塊：①整頁預覽毛玻璃透明度/模糊度（左縱軸模糊、下橫軸透明，滑桿即調即存、
   假文字即時預覽）②術語標籤 7 格編輯（與工作區術語 Modal 同一份 prefs.termTagPalette）
   ③快捷標點三組編輯（與底部標點列同一份 prefs.punctSets）④白噪音 YouTube 連結。
   未來 AI API 服務輸入介面預留於此（暫不實作）。 */

const FAKE_TEXT =
  '窓の外には静かな雨が降り、遠くの山は薄い霧に包まれていた。机の上の原稿はまだ半分も進んでいない。\n' +
  '窗外下著安靜的雨，遠方的山被薄霧籠罩。桌上的稿子還沒進行到一半。譯者喝了一口茶，繼續往下校對。';

/* ① 整頁預覽效果：滑桿吃 prefs 即調即存（cloud 端 debounce 2 秒上雲），毛玻璃層同步預覽 */
function PvEffectSection() {
  const pvTransparency = useStore(s => s.prefs.pvTransparency);
  const pvBlur = useStore(s => s.prefs.pvBlur);
  const patchPrefs = useStore(s => s.patchPrefs);
  return (
    <section className="ps-section" id="ps-pv-section">
      <h3>整頁預覽效果</h3>
      <p className="ps-hint">調整整頁預覽毛玻璃視窗的透明度與模糊度，下方矩形框即時預覽文字的清晰度變化。</p>
      <div className="ps-pv-layout">
        <div className="ps-pv-vslider-col">
          <span className="ps-slider-label">模糊度</span>
          <input type="range" className="ps-slider ps-vert" id="ps-blur-slider"
                 min="0" max="30" step="1" value={pvBlur}
                 onChange={e => patchPrefs({ pvBlur: Number(e.target.value) })} />
          <span className="ps-slider-value" id="ps-blur-value">{pvBlur}px</span>
        </div>
        <div className="ps-pv-main">
          <div className="ps-pv-box">
            <div className="ps-pv-faketext">{FAKE_TEXT}</div>
            <div className="ps-pv-glass" id="ps-pv-glass"
                 style={{ '--pv-alpha': (100 - pvTransparency) / 100, '--pv-blur': pvBlur + 'px' }} />
          </div>
          <div className="ps-pv-hrow">
            <span className="ps-slider-label">透明度</span>
            <input type="range" className="ps-slider" id="ps-transp-slider"
                   min="0" max="100" step="5" value={pvTransparency}
                   onChange={e => patchPrefs({ pvTransparency: Number(e.target.value) })} />
            <span className="ps-slider-value" id="ps-transp-value">{pvTransparency}%</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ② 術語標籤 7 格：羽毛筆解鎖編輯、再按一次儲存（與術語 Modal 同款互動；此處只編格位不指派） */
function TermTagSection() {
  const prefs = useStore(s => s.prefs);
  const patchPrefs = useStore(s => s.patchPrefs);
  const [draft, setDraft] = useState(null);   // 非 null＝編輯中
  const editing = draft !== null;
  const palette = editing ? draft : prefs.termTagPalette;
  const toggle = () => {
    if (editing) { patchPrefs({ termTagPalette: draft.map(x => x.trim()) }); setDraft(null); }
    else setDraft([...prefs.termTagPalette]);
  };
  return (
    <section className="ps-section" id="ps-tag-section">
      <h3>術語標籤</h3>
      <p className="ps-hint">編輯 7 格共用標籤字彙表（與工作區「新增／編輯術語」視窗同一份，跨裝置同步）。按羽毛筆解鎖編輯，再按一次儲存。</p>
      <div className="tag-row" id="ps-tag-row">
        {palette.map((v, i) => editing
          ? <input key={i} className="tag-slot-input" maxLength={6} data-idx={i} value={draft[i]}
                   placeholder={`#${i + 1}`}
                   onChange={e => setDraft(draft.map((x, j) => j === i ? e.target.value : x))} />
          : <span key={i} className={'tag-slot' + (v ? '' : ' blank')} data-idx={i}
                  title={v ? v : '空格位（按羽毛筆編輯）'}>{v}</span>)}
        <button type="button" className={'tag-edit-toggle' + (editing ? ' active' : '')} id="ps-tag-edit-toggle"
                title={editing ? '儲存標籤格位' : '編輯標籤格位'} onClick={toggle}>
          <i className="bi bi-feather"></i>
        </button>
      </div>
    </section>
  );
}

/* ③ 快捷標點三組：鉛筆解鎖三組一起編輯、再按一次儲存（與底部標點列同一份 prefs.punctSets） */
function PunctSection() {
  const prefs = useStore(s => s.prefs);
  const patchPrefs = useStore(s => s.patchPrefs);
  const [draft, setDraft] = useState(null);   // 非 null＝編輯中（3×10 深拷貝）
  const editing = draft !== null;
  const sets = editing ? draft : prefs.punctSets;
  const toggle = () => {
    if (editing) { patchPrefs({ punctSets: draft.map(g => g.map(x => x.trim())) }); setDraft(null); }
    else setDraft(prefs.punctSets.map(g => [...g]));
  };
  return (
    <section className="ps-section" id="ps-punct-section">
      <h3>快捷標點</h3>
      <p className="ps-hint">編輯三組快捷標點（與翻譯工作區底部標點列同一份，跨裝置同步；每格最多 4 字）。按鉛筆解鎖編輯，再按一次儲存。</p>
      {sets.map((g, gi) => (
        <div className="ps-slot-group" key={gi} data-group={gi}>
          <span className="ps-group-no">第{['一', '二', '三'][gi]}組</span>
          {g.map((p, i) => editing
            ? <input key={i} className="tag-slot-input" maxLength={4} data-idx={i} value={draft[gi][i]}
                     placeholder={String((i + 1) % 10)}
                     onChange={e => setDraft(draft.map((gr, gj) =>
                       gj === gi ? gr.map((x, j) => j === i ? e.target.value : x) : gr))} />
            : <span key={i} className={'tag-slot' + (p ? '' : ' blank')} data-idx={i}
                    title={`Ctrl/Alt+Shift+${(i + 1) % 10}`}>{p}</span>)}
        </div>
      ))}
      <div className="ps-slot-group">
        <span className="ps-group-no"></span>
        <button type="button" className={'tag-edit-toggle' + (editing ? ' active' : '')} id="ps-punct-edit-toggle"
                title={editing ? '儲存快捷標點' : '編輯快捷標點'} onClick={toggle}>
          <i className={'bi ' + (editing ? 'bi-check-lg' : 'bi-pencil')}></i>
        </button>
      </div>
    </section>
  );
}

/* mm:ss（滿一小時 h:mm:ss）；時間軸滑桿播放中顯示換算後的實際起點時間 */
function fmtTime(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/* ④ 白噪音音樂：YouTube 連結存 prefs（失焦/Enter 送出），播放鈕與 header 音樂鈕同一開關 */
function MusicSection() {
  const ytUrl = useStore(s => s.prefs.ytUrl);
  const musicVolume = useStore(s => s.prefs.musicVolume);
  const musicStartPct = useStore(s => s.prefs.musicStartPct);
  const patchPrefs = useStore(s => s.patchPrefs);
  const musicPlaying = useStore(s => s.musicPlaying);
  const musicDuration = useStore(s => s.musicDuration);
  const toggleMusic = useStore(s => s.toggleMusic);
  // 時間軸顯示三態：播放中且知總長＝實際時間；播放中總長 0＝直播（滑桿停用）；其餘＝百分比
  const isLive = musicPlaying && musicDuration === 0;
  const timeLabel = (musicPlaying && musicDuration > 0)
    ? fmtTime(musicDuration * musicStartPct / 100)
    : (isLive ? '直播' : musicStartPct + '%');
  const [val, setVal] = useState(ytUrl);
  const inputRef = useRef(null);
  // 雲端對時後 prefs.ytUrl 可能變（另一裝置寫入）：輸入框非聚焦中才跟上，避免蓋掉編輯到一半的內容
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setVal(ytUrl);
  }, [ytUrl]);
  const commit = () => { if (val.trim() !== ytUrl) patchPrefs({ ytUrl: val.trim() }); };
  return (
    <section className="ps-section" id="ps-music-section">
      <h3>白噪音音樂</h3>
      <p className="ps-hint">貼上 YouTube 連結，按「音樂播放」循環播放當作工作白噪音；頂列音樂鈕可隨時播放／停止。音量與時間軸滑桿播放中即調即生效，時間軸＝這次播放的起始位置（播完自動從頭循環）。</p>
      <div className="ps-music-row">
        <input type="text" id="ps-yt-url" ref={inputRef} placeholder="https://www.youtube.com/watch?v=…"
               value={val}
               onChange={e => setVal(e.target.value)}
               onBlur={commit}
               onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent.isComposing || e.keyCode === 229)) { e.preventDefault(); commit(); } }} />
        <button className={'btn small ' + (musicPlaying ? 'outline' : 'vermilion')} id="ps-music-btn"
                onClick={() => { commit(); toggleMusic(); }}>
          <i className={'bi ' + (musicPlaying ? 'bi-stop-fill' : 'bi-music-note')}></i>
          {musicPlaying ? ' 停止播放' : ' 音樂播放'}
        </button>
      </div>
      {/* 音量（V63 微調）：存 prefs.musicVolume 跨裝置同步；播放中 App 端 effect 即時 setVolume */}
      <div className="ps-pv-hrow ps-vol-row">
        <span className="ps-slider-label">音量</span>
        <input type="range" className="ps-slider" id="ps-vol-slider"
               min="0" max="100" step="5" value={musicVolume}
               onChange={e => patchPrefs({ musicVolume: Number(e.target.value) })} />
        <span className="ps-slider-value" id="ps-vol-value">{musicVolume}%</span>
      </div>
      {/* 時間軸（V63 微調）：本次播放起始位置＝總長×百分比（總長要播放後才知道，故存百分比；
          循環一律回 0 播整首）；播放中顯示實際時間＋拖桿即時 seek（App 端 effect）、
          未播放顯示 %、直播停用 */}
      <div className="ps-pv-hrow ps-vol-row">
        <span className="ps-slider-label">時間軸</span>
        <input type="range" className="ps-slider" id="ps-time-slider"
               min="0" max="100" step="1" value={musicStartPct} disabled={isLive}
               onChange={e => patchPrefs({ musicStartPct: Number(e.target.value) })} />
        <span className="ps-slider-value" id="ps-time-value">{timeLabel}</span>
      </div>
    </section>
  );
}

export default function SettingsTab() {
  return (
    <div className="ps-grid">
      <PvEffectSection />
      <TermTagSection />
      <PunctSection />
      <MusicSection />
    </div>
  );
}
