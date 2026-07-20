import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList }
  from 'recharts';
import { useStore } from '../store.js';
import { docStatus } from '../utils.js';

/* V61 專案管理區儀表板：自製月曆＋文件狀態環圈圖＋譯文進度長條圖＋三數字卡。
   全部指標由 store 現算（刪文件即歸零），不落地、不進儲存快照。 */

/* 圖表標記色鏡射 cat-tool.css 的狀態 token（SVG fill/stroke 屬性吃不到 CSS 變數，
   亮暗各一組，改 token 時要同步）；文字/軸線/格線改走 CSS 規則吃 var()，不在此列。
   四色與狀態徽章同義（色隨實體），色弱情境靠圖例文字＋數量＋段間縫輔助編碼。 */
const CHART_TOKENS = {
  light: { pending:'#5B5750', translating:'#B33A2E', reviewing:'#1F5C5C', done:'#F7D94C',
           surface:'#FBFAF7', cursor:'rgba(39,37,34,0.05)' },
  dark:  { pending:'#A39D90', translating:'#D9614E', reviewing:'#5FB8B8', done:'#FBE251',
           surface:'#242220', cursor:'rgba(255,255,255,0.06)' }
};

const STATUS_ORDER = [
  { key:'pending',     label:'未完成' },
  { key:'translating', label:'翻譯中' },
  { key:'reviewing',   label:'校對中' },
  { key:'done',        label:'已完成' }
];

/* 主題跟著 <html data-theme> 走（darkMode 是 App 本地 state 不進 store，這裡直接觀察屬性） */
function useThemeMode(){
  const read = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const ob = new MutationObserver(() => setMode(read()));
    ob.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    return () => ob.disconnect();
  }, []);
  return mode;
}

const TOOLTIP_STYLE = {
  background:'var(--tooltip-bg)', border:'none', borderRadius:'var(--radius)',
  color:'var(--tooltip-text)', fontSize:'var(--fs-xs)', padding:'6px 10px'
};

/* ---- 自製月曆：只顯示當月（週一起始），無翻頁/查詢功能 ---- */
function MiniCalendar(){
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), today = now.getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;   // 週一起始的前導格數
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysPrevMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for(let i = 0; i < lead; i++) cells.push({ n: daysPrevMonth - lead + 1 + i, dim:true });
  for(let n = 1; n <= daysInMonth; n++) cells.push({ n, today: n === today });
  for(let n = 1; cells.length % 7 !== 0; n++) cells.push({ n, dim:true });
  return (
    <div className="dash-card dash-cal" id="pm-dash-cal">
      <div className="dash-cal-side">
        <span className="dash-cal-day" id="pm-dash-today">{today}</span>
        <span className="dash-cal-ym">{y} 年 {m + 1} 月</span>
      </div>
      <div className="dash-cal-grid">
        {['一','二','三','四','五','六','日'].map(w =>
          <span key={w} className="dash-cal-wd">{w}</span>)}
        {cells.map((c, i) =>
          <span key={i}
                className={'dash-cal-cell' + (c.dim ? ' dim' : '') + (c.today ? ' today' : '')}>
            {c.n}
          </span>)}
      </div>
    </div>
  );
}

export default function Dashboard(){
  const documents = useStore(s => s.documents);
  const termBase = useStore(s => s.termBase);
  const tmSegments = useStore(s => s.tmSegments);
  const t = CHART_TOKENS[useThemeMode()];

  const { statusCounts, zhChars, confirmedChars, reviewedChars } = useMemo(() => {
    const statusCounts = { pending:0, translating:0, reviewing:0, done:0 };
    let zhChars = 0, confirmedChars = 0, reviewedChars = 0;
    documents.forEach(doc => {
      statusCounts[docStatus(doc).key]++;
      doc.segments.forEach(s => {
        const len = (s.zh || '').replace(/\s/g, '').length;   // 與 docStats 同口徑（去空白）
        zhChars += len;
        if(s.confirmed) confirmedChars += len;
        if(s.reviewed) reviewedChars += len;
      });
    });
    return { statusCounts, zhChars, confirmedChars, reviewedChars };
  }, [documents]);

  const donutData = STATUS_ORDER
    .map(st => ({ name: st.label, key: st.key, value: statusCounts[st.key] }))
    .filter(d => d.value > 0);
  const barData = [
    { name:'譯文字數', value: zhChars,        fill: t.pending },
    { name:'已翻譯',   value: confirmedChars, fill: t.translating },
    { name:'已校對',   value: reviewedChars,  fill: t.reviewing }
  ];

  return (
    <div className="pm-dash" id="pm-dashboard">
      <MiniCalendar />

      <div className="dash-card dash-donut" id="pm-dash-status">
        <div className="dash-title">文件狀態</div>
        <div className="dash-donut-body">
          <div className="dash-donut-plot">
            <PieChart width={132} height={132}>
              {donutData.length > 0
                ? <Pie data={donutData} dataKey="value" nameKey="name"
                       cx="50%" cy="50%" innerRadius={38} outerRadius={62}
                       startAngle={90} endAngle={-270}
                       stroke={t.surface} strokeWidth={2} isAnimationActive={false}>
                    {donutData.map(d => <Cell key={d.key} fill={t[d.key]} />)}
                  </Pie>
                : <Pie data={[{ name:'尚無文件', value:1 }]} dataKey="value"
                       cx="50%" cy="50%" innerRadius={38} outerRadius={62}
                       stroke="none" isAnimationActive={false}>
                    <Cell fill={t.cursor} />
                  </Pie>}
              {donutData.length > 0 &&
                <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color:'var(--tooltip-text)' }}
                         formatter={(v, name) => [`${v} 件`, name]} />}
            </PieChart>
            <div className="dash-donut-center">
              <b id="pm-dash-doc-total">{documents.length}</b><span>件文件</span>
            </div>
          </div>
          <ul className="dash-legend">
            {STATUS_ORDER.map(st =>
              <li key={st.key}>
                <span className="dash-legend-chip" style={{ background: t[st.key] }}></span>
                <span className="dash-legend-label">{st.label}</span>
                <b className="dash-legend-count" data-st={st.key}>{statusCounts[st.key]}</b>
              </li>)}
          </ul>
        </div>
      </div>

      <div className="dash-card dash-bar" id="pm-dash-progress">
        <div className="dash-title">譯文進度</div>
        <BarChart width={330} height={150} data={barData} layout="vertical"
                  margin={{ top: 4, right: 60, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false}
                 tickFormatter={v => v.toLocaleString()} tickLine={false} />
          <YAxis type="category" dataKey="name" width={64} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: t.cursor }} contentStyle={TOOLTIP_STYLE}
                   itemStyle={{ color:'var(--tooltip-text)' }}
                   formatter={v => [`${v.toLocaleString()} 字`, '字數']} />
          <Bar dataKey="value" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {barData.map(d => <Cell key={d.name} fill={d.fill} />)}
            <LabelList dataKey="value" position="right" formatter={v => v.toLocaleString()} />
          </Bar>
        </BarChart>
      </div>

      <div className="dash-tiles">
        <div className="dash-card dash-tile">
          <b id="pm-dash-terms">{termBase.length.toLocaleString()}</b>
          <span>術語量</span>
        </div>
        <div className="dash-card dash-tile">
          <b id="pm-dash-tm">{tmSegments.length.toLocaleString()}</b>
          <span>翻譯記憶量</span>
        </div>
        <div className="dash-card dash-tile">
          <b id="pm-dash-chars">{zhChars.toLocaleString()}</b>
          <span>累積譯文量</span>
        </div>
      </div>
    </div>
  );
}
