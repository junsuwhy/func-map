import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, MarkerType, Handle, Position, useReactFlow,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { load as loadYaml } from 'js-yaml';
import raw from '../func-map.yaml?raw';

const data = loadYaml(raw);
const NODE_W = 260;
const NODE_H = 214;
const KIND_LABEL = { file: '下載檔案', result: '送出表單後的畫面' };

const GROUP_PAD = 28;
const GROUP_HEAD = 44;
const ROW_MAX_W = 3400;
const GAP = 90;

// 每個選單分類各自用 dagre 由左往右分層，再把分類區塊排成網格；/admin 放在最左邊
function layout(nodes, edges) {
  const blocks = [];
  for (const key of Object.keys(data.groups)) {
    const members = nodes.filter((n) => n.data.group === key);
    if (!members.length) continue;
    const ids = new Set(members.map((n) => n.id));
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80 });
    g.setDefaultEdgeLabel(() => ({}));
    members.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
    // 只用「往下一層」的邊排版，回頭的連結不影響階層
    edges.filter((e) => !e.back && ids.has(e.source) && ids.has(e.target)).forEach((e) => g.setEdge(e.source, e.target));
    dagre.layout(g);
    const { width, height } = g.graph();
    blocks.push({ key, members, g, w: width + GROUP_PAD * 2, h: height + GROUP_PAD * 2 + GROUP_HEAD });
  }

  const home = blocks.find((b) => b.key === 'home');
  const rest = blocks.filter((b) => b !== home);
  const startX = home.w + GAP * 2;
  let x = startX;
  let y = 0;
  let rowH = 0;
  for (const b of rest) {
    if (x > startX && x + b.w > startX + ROW_MAX_W) { x = startX; y += rowH + GAP; rowH = 0; }
    b.x = x; b.y = y; x += b.w + GAP; rowH = Math.max(rowH, b.h);
  }
  home.x = 0; home.y = (y + rowH) / 2 - home.h / 2;

  const out = [];
  for (const b of blocks) {
    if (b !== home) {
      out.push({
        id: `group-${b.key}`, type: 'group', position: { x: b.x, y: b.y }, width: b.w, height: b.h,
        data: { group: b.key }, selectable: false, draggable: false, focusable: false,
        style: { width: b.w, height: b.h, '--group': data.groups[b.key].color },
        className: 'group-block', zIndex: -1,
      });
    }
    for (const n of b.members) {
      const p = b.g.node(n.id);
      out.push({ ...n, position: { x: b.x + GROUP_PAD + p.x - NODE_W / 2, y: b.y + GROUP_PAD + GROUP_HEAD + p.y - NODE_H / 2 } });
    }
  }
  return out;
}

function GroupNode({ data: d }) {
  return <div className="group-block__title">{data.groups[d.group].name}</div>;
}

function PageNode({ data: d }) {
  const group = data.groups[d.group] || {};
  return (
    <div className={`page-node kind-${d.kind || 'page'}`} style={{ '--group': group.color }}>
      <Handle type="target" position={Position.Left} />
      <div className="page-node__head">
        <span className="page-node__id">{d.id}</span>
        <span className="page-node__name">{d.name}</span>
        {d.stepNo && <span className="page-node__step">步驟 {d.stepNo}</span>}
      </div>
      <div className="page-node__shot">
        {d.screenshot ? (
          <img src={d.screenshot} alt={d.name} loading="lazy" />
        ) : (
          <div className="page-node__placeholder">{KIND_LABEL[d.kind] || '未截圖'}</div>
        )}
      </div>
      <div className="page-node__path" title={d.path}>{d.path}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { page: PageNode, group: GroupNode };

function buildGraph() {
  const nodes = Object.entries(data.nodes).map(([id, n]) => ({
    id: String(id),
    type: 'page',
    width: NODE_W,
    height: NODE_H,
    data: { id, ...n },
    position: { x: 0, y: 0 },
  }));

  // 兩個方向都有的 link 只畫一條；已經有「下一步」箭頭的兩頁不再重複畫 link
  const seen = new Set(data.edges.filter((e) => e.type === 'next').map((e) => [String(e.from), String(e.to)].sort().join('-')));
  const edges = [];
  data.edges.forEach((e, i) => {
    const s = String(e.from);
    const t = String(e.to);
    if (e.type === 'link') {
      const key = [s, t].sort().join('-');
      if (seen.has(key)) return;
      seen.add(key);
    }
    edges.push({ id: `e${i}`, source: s, target: t, kind: e.type, label: e.label });
  });

  // 從 /admin 做 BFS 找每個 node 的層級，target 層級不比 source 深的邊視為「回頭」
  const depth = { 1: 0 };
  const queue = ['1'];
  while (queue.length) {
    const cur = queue.shift();
    edges.filter((e) => e.source === cur).forEach((e) => {
      if (depth[e.target] === undefined) { depth[e.target] = depth[cur] + 1; queue.push(e.target); }
    });
  }
  edges.forEach((e) => { e.back = (depth[e.target] ?? 99) <= (depth[e.source] ?? 99); });
  return { nodes: layout(nodes, edges), edges };
}

function Canvas() {
  const graph = useMemo(buildGraph, []);
  const [flowKey, setFlowKey] = useState(null);
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState(null); // 逐步瀏覽目前在第幾步（null = 看整個流程）
  const canvasRef = useRef(null);
  const { fitView, setCenter } = useReactFlow();
  const flow = flowKey ? data.flows[flowKey] : null;
  const steps = useMemo(() => (flow ? flow.nodes.map(String) : []), [flow]);
  const active = useMemo(() => (flow ? new Set(steps) : null), [flow, steps]);
  const current = step !== null ? steps[step] : null;

  const nodes = useMemo(
    () => graph.nodes.map((n) => (n.type === 'group' ? n : {
      ...n,
      data: { ...n.data, stepNo: active?.has(n.id) ? steps.indexOf(n.id) + 1 : undefined },
      className: [
        active && !active.has(n.id) ? 'is-dim' : active ? 'is-active' : '',
        current === n.id ? 'is-current' : '',
      ].join(' '),
      selected: selected === n.id,
    })),
    [graph, active, steps, current, selected],
  );

  const edges = useMemo(
    () => graph.edges.map((e) => {
      const on = !active || (active.has(e.source) && active.has(e.target));
      const next = e.kind === 'next';
      const color = next ? '#d9480f' : '#8c99a6';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: next ? e.label : undefined,
        animated: next && on,
        className: on ? '' : 'is-dim',
        style: { stroke: color, strokeWidth: next ? 2.5 : 1.4, strokeDasharray: next ? undefined : '0' },
        markerEnd: next ? { type: MarkerType.ArrowClosed, color, width: 18, height: 18 } : undefined,
        labelStyle: { fill: '#9a3412', fontWeight: 600, fontSize: 12 },
        labelBgStyle: { fill: '#fff7ed' },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4,
      };
    }),
    [graph, active],
  );

  // 把某一步的 node 移到畫面正中間，縮放到 node 寬約為畫面寬的 1/5
  const goStep = useCallback((i) => {
    if (i < 0 || i >= steps.length) return;
    setStep(i);
    const n = graph.nodes.find((x) => x.id === steps[i]);
    const w = canvasRef.current?.clientWidth || window.innerWidth;
    setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: w / 5 / NODE_W, duration: 600 });
  }, [steps, graph, setCenter]);

  useEffect(() => {
    if (!flow) return undefined;
    const onKey = (ev) => {
      if (ev.target.closest?.('input, textarea')) return;
      if (ev.key === 'ArrowRight') goStep(step === null ? 0 : step + 1);
      if (ev.key === 'ArrowLeft' && step !== null) goStep(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, step, goStep]);

  const pickFlow = useCallback((key) => {
    setFlowKey(key);
    setStep(null);
    const ids = key ? data.flows[key].nodes.map(String) : undefined;
    setTimeout(() => fitView({ nodes: ids?.map((id) => ({ id })), padding: 0.15, duration: 500 }), 0);
  }, [fitView]);

  const sel = selected ? data.nodes[selected] : null;
  const selUrl = __SITE_URL__ && sel && !sel.path.includes('{') && !sel.path.startsWith('POST') ? __SITE_URL__ + sel.path : null;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>{data.meta.title}</h1>
        <div className="filters" role="group" aria-label="業務邏輯篩選">
          <button className={!flowKey ? 'on' : ''} onClick={() => pickFlow(null)}>全部</button>
          {Object.entries(data.flows).map(([k, f]) => (
            <button key={k} className={flowKey === k ? 'on' : ''} onClick={() => pickFlow(k)} title={f.source}>
              {f.name}
            </button>
          ))}
        </div>
      </header>

      {flow && (
        <div className="flow-info">
          <strong>{flow.name}</strong>
          {flow.description && <span>{flow.description}</span>}
          <small>驗收項目：{flow.source}</small>
          <div className="stepper">
            <button onClick={() => goStep(step - 1)} disabled={step === null || step === 0}>◀ 上一步</button>
            <span className="stepper__now">
              {step === null ? `共 ${steps.length} 步` : `${step + 1} / ${steps.length}　${data.nodes[current].name}`}
            </span>
            <button onClick={() => goStep(step === null ? 0 : step + 1)} disabled={step === steps.length - 1}>
              {step === null ? '開始 ▶' : '下一步 ▶'}
            </button>
          </div>
        </div>
      )}

      <div className="canvas" ref={canvasRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.05}
          maxZoom={2}
          nodesConnectable={false}
          onNodeClick={(_, n) => {
            if (n.type !== 'page') return;
            setSelected(n.id);
            if (active?.has(n.id)) setStep(steps.indexOf(n.id));
          }}
          onPaneClick={() => setSelected(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="#d7dde3" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => (n.type === 'group' ? 'transparent' : data.groups[n.data.group]?.color || '#999')}
            nodeStrokeWidth={0}
          />
        </ReactFlow>

        <aside className="legend">
          {Object.entries(data.groups).map(([k, g]) => (
            <div key={k}><i style={{ background: g.color }} />{g.name}</div>
          ))}
          <hr />
          <div><span className="line line--link" />頁面互相連結</div>
          <div><span className="line line--next" />業務流程下一步</div>
        </aside>

        {sel && (
          <aside className="detail">
            <button className="detail__close" onClick={() => setSelected(null)} aria-label="關閉">×</button>
            <div className="detail__group" style={{ color: data.groups[sel.group]?.color }}>
              #{selected} · {data.groups[sel.group]?.name}
            </div>
            <h2>{sel.name}</h2>
            <code>{sel.path}</code>
            {sel.note && <p>{sel.note}</p>}
            {sel.screenshot && (
              <a href={sel.screenshot} target="_blank" rel="noreferrer">
                <img src={sel.screenshot} alt={sel.name} />
              </a>
            )}
            {selUrl && <a className="detail__link" href={selUrl} target="_blank" rel="noreferrer">在網站開啟 ↗</a>}
            <div className="detail__flows">
              {Object.entries(data.flows)
                .filter(([, f]) => f.nodes.map(String).includes(selected))
                .map(([k, f]) => <button key={k} onClick={() => pickFlow(k)}>{f.name}</button>)}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
