import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Stage, Layer, Circle, Line, Text as KonvaText, Group, RegularPolygon, Image } from 'react-konva';
import { routeData } from '../../data/routeData';

// --- Interfaces ---


interface LightPreset {
  bg: string;
  light1Color: number;
  light1Intensity: number;
  light2Color: number;
  light2Intensity: number;
  ambientColor: number;
  ambientIntensity: number;
  point1Color: number;
  point1Intensity: number;
  point2Color: number;
  point2Intensity: number;
}

// --- Pathfinding Interfaces & Data ---
interface PortNode {
  id: string;
  name: string;
  x: number;
  y: number;
  type: 'gate' | 'weigh_station' | 'yard' | 'storage' | 'pier';
}

interface PortPath {
  id: string;
  from: string;
  to: string;
  weight: number;
  underRepair: boolean;
  obstacleStart: boolean;
  obstacleEnd: boolean;
}

const INITIAL_NODES: Record<string, PortNode> = {
  gate_a: { id: 'gate_a', name: 'Cổng A (Gate A)', x: 100, y: 100, type: 'gate' },
  gate_b: { id: 'gate_b', name: 'Cổng B (Gate B)', x: 100, y: 400, type: 'gate' },
  weigh: { id: 'weigh', name: 'Trạm Cân (Weigh Station)', x: 250, y: 250, type: 'weigh_station' },
  yard_1: { id: 'yard_1', name: 'Bãi Container 1', x: 400, y: 150, type: 'yard' },
  yard_2: { id: 'yard_2', name: 'Bãi Container 2', x: 400, y: 350, type: 'yard' },
  cold: { id: 'cold', name: 'Kho Lạnh (Cold Storage)', x: 550, y: 100, type: 'storage' },
  pier_1: { id: 'pier_1', name: 'Cầu Cảng 1 (Pier 1)', x: 700, y: 200, type: 'pier' },
  pier_2: { id: 'pier_2', name: 'Cầu Cảng 2 (Pier 2)', x: 700, y: 400, type: 'pier' },
};

const DEFAULT_PATHS: PortPath[] = [
  { id: 'p1', from: 'gate_a', to: 'weigh', weight: 150, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p2', from: 'gate_b', to: 'weigh', weight: 150, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p3', from: 'weigh', to: 'yard_1', weight: 180, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p4', from: 'weigh', to: 'yard_2', weight: 180, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p5', from: 'yard_1', to: 'cold', weight: 160, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p6', from: 'yard_2', to: 'cold', weight: 220, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p7', from: 'yard_1', to: 'yard_2', weight: 200, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p8', from: 'cold', to: 'pier_1', weight: 180, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p9', from: 'yard_2', to: 'pier_2', weight: 300, underRepair: false, obstacleStart: false, obstacleEnd: false },
  { id: 'p10', from: 'pier_1', to: 'pier_2', weight: 200, underRepair: false, obstacleStart: false, obstacleEnd: false },
];

function findShortestPath(
  nodes: Record<string, PortNode>,
  paths: PortPath[],
  startId: string,
  endId: string
): { path: string[]; distance: number; nodesCoords: Record<string, { x: number; y: number }> } | null {
  if (startId === endId) {
    return {
      path: [startId],
      distance: 0,
      nodesCoords: { [startId]: { x: nodes[startId].x, y: nodes[startId].y } }
    };
  }

  // 1. Projection of all nodes onto nearest path segments
  // Construct the base sequence of points for each path
  const pathBaseSequences: Record<string, { x: number; y: number; id: string }[]> = {};
  paths.forEach(p => {
    const fromNode = nodes[p.from];
    const toNode = nodes[p.to];
    if (!fromNode || !toNode) return;

    const seq = [];
    seq.push({ x: fromNode.x, y: fromNode.y, id: p.from });
    if (p.points && p.points.length > 0) {
      p.points.forEach((pt, idx) => {
        seq.push({ x: pt[0], y: pt[1], id: `${p.id}_pt_${idx}` });
      });
    }
    seq.push({ x: toNode.x, y: toNode.y, id: p.to });
    pathBaseSequences[p.id] = seq;
  });

  // Find the closest path segment for each gate node
  const projections: Record<string, { gateId: string; segIndex: number; t: number; x: number; y: number }[]> = {};
  paths.forEach(p => {
    projections[p.id] = [];
  });

  const gateProjNodes: Record<string, string> = {}; // gateId -> projNodeId
  const projCoords: Record<string, { x: number; y: number }> = {};

  Object.keys(nodes).forEach(gateId => {
    const G = nodes[gateId];
    let bestDist = Infinity;
    let bestPathId = '';
    let bestSegIndex = -1;
    let bestT = 0;
    let bestProjX = 0;
    let bestProjY = 0;

    paths.forEach(p => {
      const seq = pathBaseSequences[p.id];
      if (!seq || seq.length < 2) return;

      // Skip projecting a gate onto a path if it is already an endpoint of that path to prevent self-projection
      if (p.from === gateId || p.to === gateId) {
        return;
      }

      for (let i = 0; i < seq.length - 1; i++) {
        const u = seq[i];
        const v = seq[i+1];

        // Project G onto segment u -> v
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const ab_len2 = dx * dx + dy * dy;
        if (ab_len2 === 0) continue;

        let t = ((G.x - u.x) * dx + (G.y - u.y) * dy) / ab_len2;
        t = Math.max(0, Math.min(1, t));

        const px = u.x + t * dx;
        const py = u.y + t * dy;
        const dist = Math.hypot(G.x - px, G.y - py);

        if (dist < bestDist) {
          bestDist = dist;
          bestPathId = p.id;
          bestSegIndex = i;
          bestT = t;
          bestProjX = px;
          bestProjY = py;
        }
      }
    });

    // If G is not an endpoint of any path and we found a closest segment
    // and the distance is > 0.1, we project G onto it
    if (bestPathId) {
      const projNodeId = `${bestPathId}_proj_${gateId}`;
      projections[bestPathId].push({
        gateId,
        segIndex: bestSegIndex,
        t: bestT,
        x: bestProjX,
        y: bestProjY
      });
      gateProjNodes[gateId] = projNodeId;
      projCoords[projNodeId] = { x: bestProjX, y: bestProjY };
    }
  });

  // 2. Build final segmented sequences for each path
  const pathFinalSequences: Record<string, { x: number; y: number; id: string; isObs?: boolean }[]> = {};
  const pathObsIndices: Record<string, { obs1Idx: number; obs2Idx: number }> = {};

  paths.forEach(p => {
    const baseSeq = pathBaseSequences[p.id];
    if (!baseSeq || baseSeq.length < 2) return;

    const projs = projections[p.id];
    const projsBySeg: Record<number, typeof projs> = {};
    projs.forEach(pr => {
      if (!projsBySeg[pr.segIndex]) projsBySeg[pr.segIndex] = [];
      projsBySeg[pr.segIndex].push(pr);
    });

    const segmentedSeq: { x: number; y: number; id: string }[] = [];
    for (let i = 0; i < baseSeq.length; i++) {
      segmentedSeq.push(baseSeq[i]);
      if (projsBySeg[i]) {
        projsBySeg[i].sort((a, b) => a.t - b.t);
        projsBySeg[i].forEach(pr => {
          segmentedSeq.push({
            x: pr.x,
            y: pr.y,
            id: `${p.id}_proj_${pr.gateId}`
          });
        });
      }
    }

    const hasObstacles = p.obstacleStart || p.obstacleEnd;
    if (!hasObstacles) {
      pathFinalSequences[p.id] = segmentedSeq;
      pathObsIndices[p.id] = { obs1Idx: -1, obs2Idx: -1 };
      return;
    }

    // Calculate cumulative distances
    const dists: number[] = [0];
    let total = 0;
    for (let i = 0; i < segmentedSeq.length - 1; i++) {
      const d = Math.hypot(segmentedSeq[i+1].x - segmentedSeq[i].x, segmentedSeq[i+1].y - segmentedSeq[i].y);
      total += d;
      dists.push(total);
    }

    const getInsertInfo = (pct: number, id: string) => {
      const targetDist = total * pct;
      for (let i = 0; i < dists.length - 1; i++) {
        if (targetDist >= dists[i] && targetDist <= dists[i+1]) {
          const segDist = dists[i+1] - dists[i];
          const t = segDist === 0 ? 0 : (targetDist - dists[i]) / segDist;
          return {
            insertAfter: i,
            x: segmentedSeq[i].x + t * (segmentedSeq[i+1].x - segmentedSeq[i].x),
            y: segmentedSeq[i].y + t * (segmentedSeq[i+1].y - segmentedSeq[i].y),
            id
          };
        }
      }
      return {
        insertAfter: segmentedSeq.length - 2,
        x: segmentedSeq[segmentedSeq.length - 1].x,
        y: segmentedSeq[segmentedSeq.length - 1].y,
        id
      };
    };

    const obs1 = getInsertInfo(0.25, `${p.id}_obs1`);
    const obs2 = getInsertInfo(0.75, `${p.id}_obs2`);

    const finalSeq: typeof segmentedSeq = [];
    let obs1Idx = -1;
    let obs2Idx = -1;

    for (let i = 0; i < segmentedSeq.length; i++) {
      finalSeq.push(segmentedSeq[i]);
      if (i === obs1.insertAfter && i === obs2.insertAfter) {
        finalSeq.push({ x: obs1.x, y: obs1.y, id: obs1.id });
        obs1Idx = finalSeq.length - 1;
        finalSeq.push({ x: obs2.x, y: obs2.y, id: obs2.id });
        obs2Idx = finalSeq.length - 1;
      } else {
        if (i === obs1.insertAfter) {
          finalSeq.push({ x: obs1.x, y: obs1.y, id: obs1.id });
          obs1Idx = finalSeq.length - 1;
        }
        if (i === obs2.insertAfter) {
          finalSeq.push({ x: obs2.x, y: obs2.y, id: obs2.id });
          obs2Idx = finalSeq.length - 1;
        }
      }
    }

    pathFinalSequences[p.id] = finalSeq;
    pathObsIndices[p.id] = { obs1Idx, obs2Idx };
  });

  // 3. Build graph
  const adj: Record<string, { to: string; weight: number }[]> = {};
  const allNodesCoords: Record<string, { x: number; y: number }> = {};

  const addVertex = (id: string, x: number, y: number) => {
    if (!adj[id]) {
      adj[id] = [];
      allNodesCoords[id] = { x, y };
    }
  };

  const addEdge = (u: string, v: string, w: number) => {
    adj[u].push({ to: v, weight: w });
    adj[v].push({ to: u, weight: w });
  };

  // Add all base nodes
  Object.keys(nodes).forEach(id => {
    addVertex(id, nodes[id].x, nodes[id].y);
  });

  // Add connections from gates to their projected road nodes
  Object.keys(gateProjNodes).forEach(gateId => {
    const projNodeId = gateProjNodes[gateId];
    const coords = projCoords[projNodeId];
    addVertex(projNodeId, coords.x, coords.y);
    const w = Math.hypot(nodes[gateId].x - coords.x, nodes[gateId].y - coords.y);
    addEdge(gateId, projNodeId, w);
  });

  // Add edges from paths
  paths.forEach(p => {
    if (p.underRepair) return;

    const seq = pathFinalSequences[p.id];
    if (!seq || seq.length < 2) return;

    const { obs1Idx, obs2Idx } = pathObsIndices[p.id];
    const isMiddleBlocked = p.obstacleStart && p.obstacleEnd;

    for (let i = 0; i < seq.length - 1; i++) {
      if (isMiddleBlocked && obs1Idx !== -1 && obs2Idx !== -1) {
        if (i >= obs1Idx && i < obs2Idx) {
          continue;
        }
      }

      const u = seq[i];
      const v = seq[i+1];

      addVertex(u.id, u.x, u.y);
      addVertex(v.id, v.x, v.y);

      const w = Math.hypot(u.x - v.x, u.y - v.y);
      addEdge(u.id, v.id, w);
    }
  });

  // 4. Run Dijkstra
  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  const queue: string[] = [];

  Object.keys(adj).forEach(id => {
    distances[id] = Infinity;
    previous[id] = null;
    queue.push(id);
  });

  if (!(startId in distances) || !(endId in distances)) return null;

  distances[startId] = 0;

  while (queue.length > 0) {
    queue.sort((a, b) => distances[a] - distances[b]);
    const u = queue.shift()!;

    if (distances[u] === Infinity) break;
    if (u === endId) {
      const path: string[] = [];
      let curr: string | null = u;
      while (curr !== null) {
        path.unshift(curr);
        curr = previous[curr];
      }
      return { path, distance: distances[u], nodesCoords: allNodesCoords };
    }

    const neighbors = adj[u] || [];
    neighbors.forEach(neighbor => {
      if (!queue.includes(neighbor.to)) return;
      const alt = distances[u] + neighbor.weight;
      if (alt < distances[neighbor.to]) {
        distances[neighbor.to] = alt;
        previous[neighbor.to] = u;
      }
    });
  }

  return null;
}




const LIGHTS: Record<string, LightPreset> = {
  studio: {
    bg: '#0f172a',
    light1Color: 0xffffff, light1Intensity: 2.2,
    light2Color: 0x94a3b8, light2Intensity: 1.2,
    ambientColor: 0xffffff, ambientIntensity: 0.3,
    point1Color: 0xffffff, point1Intensity: 0,
    point2Color: 0xffffff, point2Intensity: 0
  },
  neon: {
    bg: '#090514',
    light1Color: 0xff005d, light1Intensity: 2.5,
    light2Color: 0x00f0ff, light2Intensity: 1.8,
    ambientColor: 0x2e0854, ambientIntensity: 0.4,
    point1Color: 0xff00bb, point1Intensity: 3.5,
    point2Color: 0x00ffcc, point2Intensity: 3.5
  },
  solar: {
    bg: '#140700',
    light1Color: 0xff7700, light1Intensity: 3.0,
    light2Color: 0xffcc00, light2Intensity: 1.5,
    ambientColor: 0x3a0c00, ambientIntensity: 0.3,
    point1Color: 0xff3300, point1Intensity: 4.0,
    point2Color: 0xffaa00, point2Intensity: 3.0
  },
  toxic: {
    bg: '#000803',
    light1Color: 0x2dff14, light1Intensity: 2.5,
    light2Color: 0xd4ff00, light2Intensity: 1.5,
    ambientColor: 0x012c05, ambientIntensity: 0.4,
    point1Color: 0x39ff14, point1Intensity: 4.0,
    point2Color: 0x00ffff, point2Intensity: 2.5
  },
  frozen: {
    bg: '#020b18',
    light1Color: 0x00bfff, light1Intensity: 2.5,
    light2Color: 0xffffff, light2Intensity: 2.0,
    ambientColor: 0x071e3d, ambientIntensity: 0.5,
    point1Color: 0xddf7ff, point1Intensity: 3.0,
    point2Color: 0x0066ff, point2Intensity: 4.0
  },
  abyss: {
    bg: '#03010a',
    light1Color: 0x8a00ff, light1Intensity: 1.8,
    light2Color: 0x221155, light2Intensity: 0.6,
    ambientColor: 0x060212, ambientIntensity: 0.1,
    point1Color: 0x8a00ff, point1Intensity: 5.0,
    point2Color: 0x000000, point2Intensity: 0
  }
};

// --- Procedural Env Map Helper ---
function generateProceduralEnvMap(): THREE.CubeTexture {
  const size = 128;
  const configs = [
    { bg: '#060814', c1: '#ff0055', c2: '#00ffff', cx: 30, cy: 30, r: 50 },  // PositiveX (Right)
    { bg: '#060814', c1: '#ffcc00', c2: '#3300ff', cx: 90, cy: 30, r: 60 },  // NegativeX (Left)
    { bg: '#0b0c20', c1: '#00ff66', c2: '#ff3300', cx: 64, cy: 64, r: 80 },  // PositiveY (Top)
    { bg: '#020205', c1: '#222222', c2: '#111111', cx: 64, cy: 64, r: 40 },  // NegativeY (Bottom)
    { bg: '#060814', c1: '#9900ff', c2: '#00ffee', cx: 20, cy: 90, r: 50 },  // PositiveZ (Front)
    { bg: '#060814', c1: '#ff00bb', c2: '#22ff00', cx: 100, cy: 100, r: 70 } // NegativeZ (Back)
  ];
  
  const hexToRgb = (hex: string) => {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
  };

  const images = configs.map(config => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = config.bg;
    ctx.fillRect(0, 0, size, size);
    
    const grad1 = ctx.createRadialGradient(config.cx, config.cy, 5, config.cx, config.cy, config.r);
    grad1.addColorStop(0, config.c1);
    grad1.addColorStop(0.3, `rgba(${hexToRgb(config.c1)}, 0.4)`);
    grad1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad1;
    ctx.fillRect(0, 0, size, size);
    
    const oppX = size - config.cx;
    const oppY = size - config.cy;
    const grad2 = ctx.createRadialGradient(oppX, oppY, 2, oppX, oppY, config.r * 0.8);
    grad2.addColorStop(0, config.c2);
    grad2.addColorStop(0.3, `rgba(${hexToRgb(config.c2)}, 0.3)`);
    grad2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, size, size);
    
    return canvas;
  });
  
  const envMap = new THREE.CubeTexture(images);
  envMap.needsUpdate = true;
  return envMap;
}

interface ArrowData {
  x: number;
  y: number;
  angle: number;
}

function getRouteArrows(points: { x: number; y: number }[], offset: number, spacing = 40): ArrowData[] {
  if (points.length < 2) return [];
  
  const segments: { p1: { x: number; y: number }; p2: { x: number; y: number }; len: number; dx: number; dy: number; angle: number }[] = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i+1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    segments.push({ p1, p2, len, dx, dy, angle });
    totalLength += len;
  }
  
  const arrows: ArrowData[] = [];
  let d = offset % spacing;
  while (d < totalLength) {
    let accum = 0;
    for (const seg of segments) {
      if (d >= accum && d <= accum + seg.len) {
        const t = seg.len === 0 ? 0 : (d - accum) / seg.len;
        const x = seg.p1.x + t * seg.dx;
        const y = seg.p1.y + t * seg.dy;
        arrows.push({ x, y, angle: seg.angle });
        break;
      }
      accum += seg.len;
    }
    d += spacing;
  }
  
  return arrows;
}

interface Bottle3DViewerProps {
  hideControls?: boolean;
  moldCode?: string;
}

export default function Bottle3DViewer({ hideControls = false, moldCode = 'default' }: Bottle3DViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes] = useState<Record<string, PortNode>>(routeData.nodes as any);
  const DEFAULT_NODES = routeData.nodes as any;

  const [viewportTheme, setViewportTheme] = useState<'dark' | 'light'>('light');
  const [activeAdminTab, setActiveAdminTab] = useState<'details' | 'gates' | 'paths' | 'environment'>('details');

  const [materialsMap, setMaterialsMap] = useState<Record<string, string>>({
    tree: "#22c55e",
    building: "#00ffff",
    crane: "#ffa500",
    asphalt: "#64748b",
    gate: "#ef4444",
    park: "#3b82f6",
    store: "#f59e0b",
    pier: "#8b5cf6"
  });
  const [materialsJsonStr, setMaterialsJsonStr] = useState<string>(JSON.stringify({
    tree: "#22c55e",
    building: "#00ffff",
    crane: "#ffa500",
    asphalt: "#64748b",
    gate: "#ef4444",
    park: "#3b82f6",
    store: "#f59e0b",
    pier: "#8b5cf6"
  }, null, 2));

  // Input states for adding new elements
  const [newGateName, setNewGateName] = useState('');
  const [newGateX, setNewGateX] = useState('');
  const [newGateY, setNewGateY] = useState('');
  const [newGateType, setNewGateType] = useState<'gate' | 'weigh_station' | 'yard' | 'storage' | 'pier'>('gate');
  const [newPathFrom, setNewPathFrom] = useState('');
  const [newPathTo, setNewPathTo] = useState('');
  const [newPathWeight, setNewPathWeight] = useState('');

  // Fetch configuration on load from Flask backend
  useEffect(() => {
    fetch(`/api/config?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data.nodes) setNodes(data.nodes);
        if (data.paths) setPaths(data.paths);
      })
      .catch(err => {
        console.log('Backend not available, using default data.', err);
      });

    fetch(`/api/material?t=${Date.now()}`)
      .then(res => {
        if (!res.ok) throw new Error('Cannot load material.json');
        return res.json();
      })
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          setMaterialsMap(data);
          setMaterialsJsonStr(JSON.stringify(data, null, 2));
        }
      })
      .catch(err => {
        console.log('Failed to fetch /api/material, using default preset.', err);
      });
  }, []);

  const handleAddGate = () => {
    if (!newGateName || !newGateX || !newGateY) {
      alert('Vui lòng nhập đầy đủ thông tin Gate!');
      return;
    }
    const id = 'gate_' + Math.random().toString(36).substr(2, 9);
    const newNode: PortNode = {
      id,
      name: newGateName,
      x: parseInt(newGateX, 10),
      y: parseInt(newGateY, 10),
      type: newGateType
    };
    setNodes(prev => ({ ...prev, [id]: newNode }));
    setNewGateName('');
    setNewGateX('');
    setNewGateY('');
  };

  const handleAddPath = () => {
    if (!newPathFrom || !newPathTo || !newPathWeight) {
      alert('Vui lòng nhập đầy đủ thông tin Tuyến đường!');
      return;
    }
    if (newPathFrom === newPathTo) {
      alert('Điểm đầu và điểm cuối không thể trùng nhau!');
      return;
    }
    const id = `path_${newPathFrom}_${newPathTo}`;
    if (paths.some(p => p.id === id || (p.from === newPathTo && p.to === newPathFrom))) {
      alert('Tuyến đường này đã tồn tại!');
      return;
    }
    const newPath = {
      id,
      from: newPathFrom,
      to: newPathTo,
      weight: parseInt(newPathWeight, 10),
      underRepair: false,
      obstacleStart: false,
      obstacleEnd: false
    };
    setPaths(prev => [...prev, newPath]);
    setNewPathWeight('');
  };

  const handleSaveToBackend = () => {
    fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nodes, paths })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        alert('Đã lưu bản đồ thành công vào Backend!');
      } else {
        alert('Lỗi: ' + data.error);
      }
    })
    .catch(err => {
      alert('Không thể kết nối đến Flask backend. Vui lòng đảm bảo backend đang chạy.');
      console.error(err);
    });
  };

  const saveToBackendLazy = (currentNodes: Record<string, PortNode>, currentPaths: PortPath[]) => {
    fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nodes: currentNodes, paths: currentPaths })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        console.log('Successfully saved to backend (lazy)');
      } else {
        console.error('Failed to save to backend (lazy):', data.error);
      }
    })
    .catch(err => {
      console.error('Error saving to backend (lazy):', err);
    });
  };
  
  // Custom states (Default to plastic per user request)
  const [activePreset, setActivePreset] = useState<string>('plastic');
  const [activeLighting, setActiveLighting] = useState<string>('frozen');
  const [color, setColor] = useState<string>('#0ea5e9');
  const [roughness, setRoughness] = useState<number>(0.18);
  const [metalness, setMetalness] = useState<number>(0.05);
  const [transmission, setTransmission] = useState<number>(0.0);
  const [autoRotateSpeed, setAutoRotateSpeed] = useState<number>(0);
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(-1);
  const [fps, setFps] = useState<number>(60);
  const [isControlPanelCollapsed, setIsControlPanelCollapsed] = useState<boolean>(false);
  const [isMobileCollapsed, setIsMobileCollapsed] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');

  // Port routing states
  const [paths, setPaths] = useState<any[]>(() => {
    const saved = localStorage.getItem(`port_paths_${moldCode}`);
    return saved ? JSON.parse(saved) : routeData.paths;
  });
  const [startNode, setStartNode] = useState<string>(() => {
    return localStorage.getItem(`port_start_node_${moldCode}`) || 'gate_a';
  });
  const [endNode, setEndNode] = useState<string>(() => {
    return localStorage.getItem(`port_end_node_${moldCode}`) || 'pier_1';
  });

  // Admin Modal states
  const [isAdminModalOpen, setIsAdminModalOpen] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<'select' | 'obstacle' | 'add_gate'>('select');
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [selectedObstacle, setSelectedObstacle] = useState<{ pathId: string; position: 'start' | 'end' } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Zoom/Pan states for Konva Map
  const [stageScale, setStageScale] = useState({ x: 1, y: 1 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [mobileStageScale, setMobileStageScale] = useState({ x: 0.45, y: 0.45 });
  const [mobileStagePos, setMobileStagePos] = useState({ x: -15, y: -10 });

  // Responsive canvas sizing for Konva Stage
  const [canvasSize, setCanvasSize] = useState({ width: 710, height: 618 });
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdminModalOpen) return;
    const updateSize = () => {
      if (canvasContainerRef.current) {
        setCanvasSize({
          width: canvasContainerRef.current.clientWidth,
          height: canvasContainerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    const timer = setTimeout(updateSize, 100);
    return () => {
      window.removeEventListener('resize', updateSize);
      clearTimeout(timer);
    };
  }, [isAdminModalOpen]);

  // Mobile app navigation flow states
  const [mobileScreen, setMobileScreen] = useState<'planning' | 'navigation' | 'completion'>('planning');
  const [navProgress, setNavProgress] = useState<number>(0);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [animationOffset, setAnimationOffset] = useState<number>(0);
  const [cameraFollowTruck, setCameraFollowTruck] = useState<boolean>(true);
  const [navSpeed, setNavSpeed] = useState<number>(120); // ms per simulation tick
  
  const [visitStatus, setVisitStatus] = useState<'done' | 'failed' | 'skipped'>('done');
  const [visitNotes, setVisitNotes] = useState<string>('');
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wayfindingGroupRef = useRef<THREE.Group | null>(null);
  const truckMeshRef = useRef<THREE.Group | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);

  // references moved below vehiclePosition to avoid TDZ reference errors

  // Update system time
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load port settings from LocalStorage when moldCode changes
  useEffect(() => {
    const savedPaths = localStorage.getItem(`port_paths_${moldCode}`);
    if (savedPaths) {
      try {
        setPaths(JSON.parse(savedPaths));
      } catch (e) {
        console.error("Error parsing saved paths", e);
      }
    } else {
      setPaths(DEFAULT_PATHS);
    }

    const savedStart = localStorage.getItem(`port_start_node_${moldCode}`);
    if (savedStart) setStartNode(savedStart);
    else setStartNode('gate_a');

    const savedEnd = localStorage.getItem(`port_end_node_${moldCode}`);
    if (savedEnd) setEndNode(savedEnd);
    else setEndNode('pier_1');
  }, [moldCode]);

  // Save port settings to LocalStorage when they change
  useEffect(() => {
    localStorage.setItem(`port_paths_${moldCode}`, JSON.stringify(paths));
  }, [paths, moldCode]);

  useEffect(() => {
    localStorage.setItem(`port_start_node_${moldCode}`, startNode);
  }, [startNode, moldCode]);

  useEffect(() => {
    localStorage.setItem(`port_end_node_${moldCode}`, endNode);
  }, [endNode, moldCode]);

  // Simulate vehicle navigation movement
  useEffect(() => {
    if (!isNavigating) return;

    const timer = setInterval(() => {
      setNavProgress(prev => {
        if (prev >= 100) {
          setIsNavigating(false);
          return 100;
        }
        return prev + 1; // Increment by 1% each tick
      });
    }, navSpeed);

    return () => clearInterval(timer);
  }, [isNavigating, navSpeed]);

  // Load settings from LocalStorage when moldCode changes
  useEffect(() => {
    const saved = localStorage.getItem(`mold_3d_settings_${moldCode}`);
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.activePreset) setActivePreset(settings.activePreset);
        if (settings.activeLighting) setActiveLighting(settings.activeLighting);
        if (settings.color) setColor(settings.color);
        if (settings.roughness !== undefined) setRoughness(settings.roughness);
        if (settings.metalness !== undefined) setMetalness(settings.metalness);
        if (settings.transmission !== undefined) setTransmission(settings.transmission);
        if (settings.autoRotateSpeed !== undefined) setAutoRotateSpeed(settings.autoRotateSpeed);
        if (settings.showWireframe !== undefined) setShowWireframe(settings.showWireframe);
      } catch (e) {
        console.error("Error parsing saved 3D settings", e);
      }
    } else {
      // Reset to defaults
      setActivePreset('plastic');
      setActiveLighting('studio');
      setColor('#0ea5e9');
      setRoughness(0.18);
      setMetalness(0.05);
      setTransmission(0.0);
      setAutoRotateSpeed(1.5);
      setShowWireframe(false);
    }
  }, [moldCode]);

  // Save settings to LocalStorage when any state changes
  useEffect(() => {
    const settings = {
      activePreset,
      activeLighting,
      color,
      roughness,
      metalness,
      transmission,
      autoRotateSpeed,
      showWireframe
    };
    localStorage.setItem(`mold_3d_settings_${moldCode}`, JSON.stringify(settings));
  }, [moldCode, activePreset, activeLighting, color, roughness, metalness, transmission, autoRotateSpeed, showWireframe]);



  useEffect(() => {
    if (!mountRef.current) return;

    let lineMaterials: any[] = [];
    const container = mountRef.current;
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 500;

    // 1. Renderer Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 2. Scene & Camera Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.0003);

    const camera = new THREE.PerspectiveCamera(40, width / height, 10.0, 5000);
    camera.position.set(1000, 1200, 1500);

    // 3. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 100, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 100.0;
    controls.maxDistance = 4000.0;
    controls.maxPolarAngle = Math.PI / 2 + 0.1; // Limit below ground plane

    // 4. Generate Environmental reflection cube map
    const envMap = generateProceduralEnvMap();
    scene.environment = envMap;

    // 5. Lights setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight1.position.set(500, 2000, 500);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    dirLight1.shadow.bias = -0.0005;
    dirLight1.shadow.camera.left = -1500;
    dirLight1.shadow.camera.right = 1500;
    dirLight1.shadow.camera.top = 1500;
    dirLight1.shadow.camera.bottom = -1500;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 5000;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 1.0);
    dirLight2.position.set(-500, 2000, -500);
    scene.add(dirLight2);

    // Dynamic point lights for glowing effect
    const pointLight1 = new THREE.PointLight(0xff00bb, 0, 5);
    pointLight1.position.set(1.5, 0.5, 1.5);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x00ffcc, 0, 5);
    pointLight2.position.set(-1.5, 0.8, -1.5);
    scene.add(pointLight2);

    // Viewport AxesHelper and labels to display X, Y, Z axes
    const createTextSprite = (text: string, color: string): THREE.Sprite => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = 'bold 44px Arial';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.18, 0.18, 1.0);
      return sprite;
    };

    const axesGroup = new THREE.Group();
    const axesHelper = new THREE.AxesHelper(1.0); // 0.1x (size 1.0 instead of 10.0!)
    axesGroup.add(axesHelper);

    const spriteX = createTextSprite('X', '#ef4444');
    spriteX.position.set(1.1, 0, 0);
    axesGroup.add(spriteX);

    const spriteY = createTextSprite('Y', '#22c55e');
    spriteY.position.set(0, 1.1, 0);
    axesGroup.add(spriteY);

    const spriteZ = createTextSprite('Z', '#3b82f6');
    spriteZ.position.set(0, 0, 1.1);
    axesGroup.add(spriteZ);

    scene.add(axesGroup);

    // 6. Bottle Material
    const bottleMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness: roughness,
      metalness: metalness,
      transmission: transmission,
      thickness: 1.2,
      ior: 1.52,
      envMap: envMap,
      envMapIntensity: 1.5,
      clearcoat: 0.3,
      clearcoatRoughness: 0.1
    });

    // 7. Load OBJ Model (Port Layout + 10 Trucks)
    let bottleMesh: THREE.Group | null = null;
    let sceneBoundingBoxStr = '';
    setLoadingProgress(0);

    const objLoader = new OBJLoader();
    const loadModel = (url: string): Promise<THREE.Group> => {
      return new Promise((resolve, reject) => {
        objLoader.load(url, resolve, undefined, reject);
      });
    };

    let fbxLoader: any;
    const loadFbxModel = async (url: string): Promise<THREE.Group> => {
      if (!fbxLoader) {
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
        fbxLoader = new FBXLoader();
      }
      return new Promise((resolve, reject) => {
        fbxLoader.load(url, resolve, undefined, reject);
      });
    };

    Promise.all([
      loadModel('/asset/general.obj'),
      loadModel('/asset/truck.obj'),
      loadModel('/asset/pin.obj'),
      import('three/examples/jsm/lines/Line2.js'),
      import('three/examples/jsm/lines/LineGeometry.js'),
      import('three/examples/jsm/lines/LineMaterial.js')
    ]).then(([generalObj, truckObj, pinObj, line2Module, geometryModule, materialModule]) => {
      const { Line2 } = line2Module;
      const { LineGeometry } = geometryModule;
      const { LineMaterial } = materialModule;
      const mainGroup = new THREE.Group();

      // 1. Process General Port Layout
      generalObj.scale.set(1000, 1000, 1000);

      generalObj.position.set(0, 0, 0);

      generalObj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          const meshName = (child.name || '').toLowerCase();
          const matName = (child.material && child.material.name ? child.material.name.toLowerCase() : '');

          let colorHex = 0xffffff; // default white
          const matchKey = Object.keys(materialsMap).find(k => meshName.includes(k.toLowerCase()) || matName.includes(k.toLowerCase()));

          if (matchKey) {
            colorHex = parseInt((materialsMap[matchKey] || '#ffffff').replace('#', '0x'), 16);
          } else if (meshName.includes('terrain') || matName.includes('terrain')) {
            colorHex = 0x1e293b;
          }

          child.material = new THREE.MeshStandardMaterial({
            color: colorHex,
            roughness: 0.8,
            metalness: 0.1
          });
        }
      });
      
      // Scale is properly handled by targetSize above
      mainGroup.add(generalObj);

      const truckClone = truckObj.clone();
      truckClone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0xf59e0b, // Bright Amber truck
            roughness: 0.4,
            metalness: 0.8
          });
        }
      });
      truckClone.scale.set(4.0, 4.0, 4.0); // Make it clearly visible on the road
      truckClone.position.set(0, -9999, 0); // Hide initially
      mainGroup.add(truckClone);
      truckMeshRef.current = truckClone;

      const routeGroup = new THREE.Group();
      routeGroup.position.set(0, 1.0, 0); // raised by 1 unit to float above generalObj

      let loadedObjectsCount = 0;
      if (pinObj) {
        Object.keys(routeData.nodes).forEach(nodeId => {
          const node = routeData.nodes[nodeId];
          if (node.type && node.type.toUpperCase() === 'GATE') {
            const pinClone = pinObj.clone();
            
            const mapName = (node.name || '').toLowerCase();
            const colorHex = parseInt((materialsMap[Object.keys(materialsMap).find(k => mapName.includes(k)) || 'gate'] || '#ffffff').replace('#', '0x'), 16);

            pinClone.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.material = new THREE.MeshBasicMaterial({
                  color: colorHex
                });
              }
            });

            const posX = node.y;
            const posZ = node.x;
            pinClone.scale.set(1, 1, 1);
            pinClone.position.set(posX, 0, posZ);
            routeGroup.add(pinClone);
            loadedObjectsCount++;

            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 1024;
            const context = canvas.getContext('2d');
            if (context) {
              context.fillStyle = 'rgba(0,0,0,0)';
              context.fillRect(0, 0, 1024, 1024);
              context.font = 'bold 60px Inter, sans-serif';
              context.fillStyle = materialsMap[Object.keys(materialsMap).find(k => mapName.includes(k)) || 'gate'] || '#ffffff';
              context.textAlign = 'center';
              context.textBaseline = 'middle';
              context.fillText(node.name.toUpperCase(), 512, 512);

              const texture = new THREE.CanvasTexture(canvas);
              texture.needsUpdate = true;
              const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false });
              const sprite = new THREE.Sprite(spriteMaterial);
              sprite.position.set(0, 40, 0); // Position it 40 units above the node!
              sprite.scale.set(150, 150, 1); // Make the sprite bigger!
              pinClone.add(sprite);
            }
          }
        });

        // 3D paths mapping
        routeData.paths.forEach(path => {
          const fromNode = routeData.nodes[path.from];
          const toNode = routeData.nodes[path.to];
          if (fromNode && toNode) {
            const pointsCoords = [];
            if (path.points && path.points.length > 0) {
              path.points.forEach((p: number[]) => {
                pointsCoords.push(p[1], 0, p[0]);
              });
            } else {
              pointsCoords.push(fromNode.y, 0, fromNode.x);
              pointsCoords.push(toNode.y, 0, toNode.x);
            }
            
            const geometry = new LineGeometry();
            geometry.setPositions(pointsCoords);
            
            const material = new LineMaterial({
              color: 0xff0000, // Red color
              linewidth: 3, // Double width (LineMaterial unit is pixels on screen space)
              dashed: true,
              dashScale: 0.5,
              dashSize: 10,
              gapSize: 5,
              resolution: new THREE.Vector2(container.clientWidth || 800, container.clientHeight || 600),
              transparent: true,
              opacity: 0.9
            });
            
            lineMaterials.push(material);
            
            const line = new Line2(geometry, material);
            line.computeLineDistances();
            routeGroup.add(line);
          }
        });
      }

      mainGroup.add(routeGroup);

      const wayfindingGroup = new THREE.Group();
      wayfindingGroup.position.y = 1.1; // Float slightly above the roads
      mainGroup.add(wayfindingGroup);
      wayfindingGroupRef.current = wayfindingGroup;

      mainGroup.position.y = 0.0;
      scene.add(mainGroup);
      bottleMesh = mainGroup;
      
      const bbox = new THREE.Box3().setFromObject(mainGroup);
      sceneBoundingBoxStr = `<br/>BOX: MIN(${bbox.min.x.toFixed(2)}, ${bbox.min.y.toFixed(2)}, ${bbox.min.z.toFixed(2)}) MAX(${bbox.max.x.toFixed(2)}, ${bbox.max.y.toFixed(2)}, ${bbox.max.z.toFixed(2)})<br/>SIZE: W:${(bbox.max.x - bbox.min.x).toFixed(2)} H:${(bbox.max.y - bbox.min.y).toFixed(2)} D:${(bbox.max.z - bbox.min.z).toFixed(2)}<br/>TOTAL 3D OBJECTS LOADED: ${loadedObjectsCount}`;
      
      setLoadingProgress(-1); // Finished
    }).catch((err) => {
      console.error('Failed to load assets', err);
      setLoadingProgress(-2); // Error
    });

    // 8. Animation Frame Loop
    let animationFrameId: number;
    let lastAppliedLighting = '';
    
    let frames = 0;
    let lastFpsUpdate = performance.now();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // A. Dynamic material updates
      if (bottleMesh) {
        bottleMesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => {
              if ('wireframe' in mat) {
                mat.wireframe = stateRef.current.showWireframe;
              }
            });
          }
        });
      }

      // B. Custom lighting updates
      const lightConfig = LIGHTS[stateRef.current.activeLighting];
      if (lightConfig && stateRef.current.activeLighting !== lastAppliedLighting) {
        dirLight1.color.setHex(lightConfig.light1Color);
        dirLight1.intensity = lightConfig.light1Intensity;
        
        dirLight2.color.setHex(lightConfig.light2Color);
        dirLight2.intensity = lightConfig.light2Intensity;
        
        ambientLight.color.setHex(lightConfig.ambientColor);
        ambientLight.intensity = lightConfig.ambientIntensity;
        
        pointLight1.color.setHex(lightConfig.point1Color);
        pointLight1.intensity = lightConfig.point1Intensity;
        
        pointLight2.color.setHex(lightConfig.point2Color);
        pointLight2.intensity = lightConfig.point2Intensity;

        lastAppliedLighting = stateRef.current.activeLighting;
      }

      // Apply viewportTheme background & ground plane color dynamically
      const isDark = stateRef.current.viewportTheme === 'dark';
      const bgColor = isDark ? (lightConfig ? lightConfig.bg : 0x0f172a) : 0xbae6fd;
      scene.background = new THREE.Color(bgColor);
      if (scene.fog) {
        scene.fog.color = new THREE.Color(bgColor);
      }
      // Default ground plane and grid were removed

      // Pulse neon point lights if active
      if (stateRef.current.activeLighting === 'neon' || stateRef.current.activeLighting === 'solar') {
        const pulse = Math.sin(performance.now() * 0.005) * 0.3 + 0.7;
        pointLight1.intensity = lightConfig.point1Intensity * pulse;
        pointLight2.intensity = lightConfig.point2Intensity * pulse;
      }

      // C. Auto Rotation
      if (bottleMesh && stateRef.current.autoRotateSpeed > 0) {
        bottleMesh.rotation.y += 0.01 * stateRef.current.autoRotateSpeed;
      }

       // Animate wayfinding textures
      if (wayfindingGroupRef.current) {
        wayfindingGroupRef.current.children.forEach(child => {
          if (child && (child as any).texture) {
            (child as any).texture.offset.x -= 0.015;
          }
        });
      }

      // D. Update truck simulation position & rotation in 3D
      const truckMesh = truckMeshRef.current;
      if (truckMesh) {
        const isNav = stateRef.current.isNavigating;
        const route = stateRef.current.routeResult;
        const vPos = stateRef.current.vehiclePosition;
        
        if (isNav && route && route.path.length >= 2) {
          truckMesh.visible = true;
          // Translate 2D map to 3D scene: X -> Z, Y -> X
          const truckX = vPos.y;
          const truckZ = vPos.x;
          const truckY = 2.0; // Raise slightly above the road
          
          truckMesh.position.set(truckX, truckY, truckZ);
          
          // Rotate truck to point along the route
          const rad = (90 - vPos.angle) * Math.PI / 180;
          truckMesh.rotation.y = rad;
          
          // Camera follow mode
          if (stateRef.current.cameraFollowTruck) {
            const forwardX = Math.sin(rad);
            const forwardZ = Math.cos(rad);
            
            // Camera position: 60 units behind, 45 units above the truck
            const camX = truckX - forwardX * 60;
            const camY = truckY + 45;
            const camZ = truckZ - forwardZ * 60;
            
            camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.05);
            controls.target.lerp(new THREE.Vector3(truckX, truckY, truckZ), 0.05);
          }
        } else {
          // If not navigating but there is a route, put truck at starting node
          if (route && route.path.length > 0) {
            truckMesh.visible = true;
            const startNodeId = route.path[0];
            const startCoords = route.nodesCoords && startNodeId in route.nodesCoords 
              ? route.nodesCoords[startNodeId] 
              : (DEFAULT_NODES[startNodeId] ? { x: DEFAULT_NODES[startNodeId].x, y: DEFAULT_NODES[startNodeId].y } : null);
            
            if (startCoords) {
              truckMesh.position.set(startCoords.y, 2.0, startCoords.x);
              
              if (route.path.length > 1) {
                const nextNodeId = route.path[1];
                const nextCoords = route.nodesCoords && nextNodeId in route.nodesCoords
                  ? route.nodesCoords[nextNodeId]
                  : (DEFAULT_NODES[nextNodeId] ? { x: DEFAULT_NODES[nextNodeId].x, y: DEFAULT_NODES[nextNodeId].y } : null);
                if (nextCoords) {
                  const dx = nextCoords.y - startCoords.y;
                  const dz = nextCoords.x - startCoords.x;
                  truckMesh.rotation.y = Math.atan2(dz, dx);
                }
              }
              
              // If follow is checked, camera also centers on starting truck position
              if (stateRef.current.cameraFollowTruck) {
                const rad = truckMesh.rotation.y;
                const forwardX = Math.sin(rad);
                const forwardZ = Math.cos(rad);
                const camX = startCoords.y - forwardX * 60;
                const camY = 2.0 + 45;
                const camZ = startCoords.x - forwardZ * 60;
                camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.05);
                controls.target.lerp(new THREE.Vector3(startCoords.y, 2.0, startCoords.x), 0.05);
              }
            }
          } else {
            truckMesh.visible = false;
          }
        }
      }

      controls.update();
      renderer.render(scene, camera);

      const infoBadge = document.getElementById('camera-info-badge');
      if (infoBadge) {
        infoBadge.innerHTML = `CAM: X: ${camera.position.x.toFixed(2)} Y: ${camera.position.y.toFixed(2)} Z: ${camera.position.z.toFixed(2)}<br/>TAR: X: ${controls.target.x.toFixed(2)} Y: ${controls.target.y.toFixed(2)} Z: ${controls.target.z.toFixed(2)}${sceneBoundingBoxStr}`;
      }

      // FPS tracking
      frames++;
      const now = performance.now();
      if (now - lastFpsUpdate > 1000) {
        setFps(Math.round((frames * 1000) / (now - lastFpsUpdate)));
        frames = 0;
        lastFpsUpdate = now;
      }
    };

    animate();

    // 9. Resize Handling
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      lineMaterials.forEach(mat => {
        if (mat.resolution) mat.resolution.set(w, h);
      });
      if (wayfindingGroupRef.current) {
        wayfindingGroupRef.current.children.forEach(child => {
          const mat = (child as any).material;
          if (mat && mat.resolution) {
            mat.resolution.set(w, h);
          }
        });
      }
    };
    
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    // 10. Clean-up on unmount
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      wayfindingGroupRef.current = null;
      
      // Dispose materials & geometries
      bottleMaterial.dispose();
      lineMaterials.forEach(mat => mat.dispose());
      axesGroup.traverse((child) => {
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        } else if (child instanceof THREE.AxesHelper) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      envMap.dispose();

      if (bottleMesh) {
        bottleMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
          }
        });
      }

      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [materialsMap]);

  // Pathfinding result
  const routeResult = useMemo(() => {
    return findShortestPath(DEFAULT_NODES, paths, startNode, endNode);
  }, [paths, startNode, endNode]);

  // Continuous 2D wayfinding arrow offset animation tick
  useEffect(() => {
    if (!routeResult) return;
    let animId: number;
    const tick = () => {
      setAnimationOffset(prev => prev + 1.5);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [routeResult]);



  // Admin action handlers

  const handleToggleObstacle = useCallback((pathId: string, position: 'start' | 'end', value: boolean) => {
    setPaths(prev => prev.map(p => {
      if (p.id !== pathId) return p;
      return {
        ...p,
        obstacleStart: position === 'start' ? value : p.obstacleStart,
        obstacleEnd: position === 'end' ? value : p.obstacleEnd,
      };
    }));
  }, []);

  // Konva stage zoom/pan handlers
  const handleWheel = useCallback((e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.08;
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const finalScale = Math.max(0.5, Math.min(4, newScale));

    setStageScale({ x: finalScale, y: finalScale });
    setStagePos({
      x: pointer.x - mousePointTo.x * finalScale,
      y: pointer.y - mousePointTo.y * finalScale,
    });
  }, []);

  const handleMobileWheel = useCallback((e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.08;
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const finalScale = Math.max(0.2, Math.min(4, newScale));

    setMobileStageScale({ x: finalScale, y: finalScale });
    setMobileStagePos({
      x: pointer.x - mousePointTo.x * finalScale,
      y: pointer.y - mousePointTo.y * finalScale,
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setStageScale(prev => {
      const newScale = Math.min(4, prev.x * 1.2);
      return { x: newScale, y: newScale };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setStageScale(prev => {
      const newScale = Math.max(0.5, prev.x / 1.2);
      return { x: newScale, y: newScale };
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setStageScale({ x: 1, y: 1 });
    setStagePos({ x: 0, y: 0 });
  }, []);

  // Coordinate helper that resolves both base port nodes and temporary obstacle sub-segment nodes
  const getNodeCoordinates = useCallback((nodeId: string) => {
    if (routeResult && routeResult.nodesCoords && nodeId in routeResult.nodesCoords) {
      return routeResult.nodesCoords[nodeId];
    }
    if (nodeId in DEFAULT_NODES) {
      return { x: DEFAULT_NODES[nodeId].x, y: DEFAULT_NODES[nodeId].y };
    }
    if (nodeId.includes('_obs')) {
      const parts = nodeId.split('_obs');
      const pathId = parts[0];
      const obsIdx = parts[1]; // '1' or '2'
      const path = paths.find(p => p.id === pathId);
      if (path) {
        const fromNode = DEFAULT_NODES[path.from];
        const toNode = DEFAULT_NODES[path.to];
        const pct = obsIdx === '1' ? 0.25 : 0.75;
        return {
          x: fromNode.x + (toNode.x - fromNode.x) * pct,
          y: fromNode.y + (toNode.y - fromNode.y) * pct,
        };
      }
    }
    return { x: 250, y: 250 };
  }, [routeResult, paths, DEFAULT_NODES]);

  // Helper to make duplicate node names unique by appending their region/position (e.g. PARK E Left/Right)
  const getNodeDisplayName = useCallback((nodeId: string) => {
    const node = DEFAULT_NODES[nodeId];
    if (!node) return '';
    
    const duplicates = Object.values(DEFAULT_NODES).filter((n: any) => n.name === node.name);
    if (duplicates.length > 1) {
      const isLeft = node.x < 0;
      return `${node.name} (${isLeft ? 'Khu Tây / Trái' : 'Khu Đông / Phải'})`;
    }
    return node.name;
  }, [DEFAULT_NODES]);

  // Helper to zoom fit wayfinding path on Konva stages (desktop & mobile)
  const fitRouteOnStage = useCallback((isMobileStage: boolean, containerWidth: number, containerHeight: number) => {
    if (!routeResult || routeResult.path.length < 2) return;
    
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    
    routeResult.path.forEach(nodeId => {
      const coords = getNodeCoordinates(nodeId);
      const x = isMobileStage ? coords.y : coords.x;
      const y = isMobileStage ? coords.x : coords.y;
      
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    
    const pathWidth = maxX - minX;
    const pathHeight = maxY - minY;
    
    if (pathWidth === 0 && pathHeight === 0) return;
    
    const padding = 60;
    const targetW = pathWidth + padding * 2;
    const targetH = pathHeight + padding * 2;
    
    const scaleX = containerWidth / targetW;
    const scaleY = containerHeight / targetH;
    const scale = Math.min(scaleX, scaleY, 2.0); // cap scale at 2.0
    
    const centerX = minX + pathWidth / 2;
    const centerY = minY + pathHeight / 2;
    
    const posX = containerWidth / 2 - centerX * scale;
    const posY = containerHeight / 2 - centerY * scale;
    
    if (isMobileStage) {
      setMobileStageScale({ x: scale, y: scale });
      setMobileStagePos({ x: posX, y: posY });
    } else {
      setStageScale({ x: scale, y: scale });
      setStagePos({ x: posX, y: posY });
    }
  }, [routeResult, getNodeCoordinates]);

  // Trigger zoom fit when routeResult changes
  useEffect(() => {
    if (routeResult && routeResult.path.length >= 2) {
      if (canvasSize.width > 0 && canvasSize.height > 0) {
        fitRouteOnStage(false, canvasSize.width, canvasSize.height);
      }
      fitRouteOnStage(true, 356, Math.round(window.innerHeight * 0.5));
    }
  }, [routeResult, canvasSize, fitRouteOnStage]);

  // Update wayfinding line in 3D scene when routeResult changes
  useEffect(() => {
    const wayfindingGroup = wayfindingGroupRef.current;
    if (!wayfindingGroup) return;

    // Clear existing wayfinding line
    while (wayfindingGroup.children.length > 0) {
      const child = wayfindingGroup.children[0];
      if (child instanceof THREE.Mesh || (child as any).isLine2) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m: any) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      wayfindingGroup.remove(child);
    }

    if (!routeResult || routeResult.path.length < 2) return;

    class LinearPathCurve extends THREE.Curve<THREE.Vector3> {
      points: THREE.Vector3[];
      constructor(points: THREE.Vector3[]) {
        super();
        this.points = points;
      }
      getPoint(t: number, optionalTarget = new THREE.Vector3()) {
        const point = optionalTarget;
        if (this.points.length === 0) return point;
        if (this.points.length === 1) return point.copy(this.points[0]);
        
        const totalSegments = this.points.length - 1;
        const scaledT = t * totalSegments;
        const index = Math.floor(scaledT);
        const segmentT = scaledT - index;
        
        if (index >= totalSegments) {
          return point.copy(this.points[totalSegments]);
        }
        
        const p1 = this.points[index];
        const p2 = this.points[index + 1];
        point.lerpVectors(p1, p2, segmentT);
        return point;
      }
    }

    const threePoints: THREE.Vector3[] = [];
    routeResult.path.forEach(nodeId => {
      const coords = getNodeCoordinates(nodeId);
      // Raise slightly above the ground (Y = 2.0)
      threePoints.push(new THREE.Vector3(coords.y, 2.0, coords.x));
    });

    const curve = new LinearPathCurve(threePoints);
    const geometry = new THREE.TubeGeometry(curve, 128, 2.0, 8, false);

    // Create arrow pattern texture using HTML canvas
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, 128, 32);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(10, 16);
      ctx.lineTo(80, 16);
      ctx.lineTo(80, 6);
      ctx.lineTo(118, 16);
      ctx.lineTo(80, 26);
      ctx.lineTo(80, 16);
      ctx.closePath();
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Repeat texture based on path length
    let totalLength = 0;
    for (let i = 0; i < routeResult.path.length - 1; i++) {
      const c1 = getNodeCoordinates(routeResult.path[i]);
      const c2 = getNodeCoordinates(routeResult.path[i+1]);
      totalLength += Math.hypot(c1.x - c2.x, c1.y - c2.y);
    }
    texture.repeat.set(Math.max(1, totalLength / 20), 1); // 1 arrow every 20 units

    const material = new THREE.MeshBasicMaterial({
      color: 0xf97316, // Orange animated path
      map: texture,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    wayfindingGroup.add(mesh);

    (mesh as any).isWayfinding = true;
    (mesh as any).texture = texture;

    return () => {};
  }, [routeResult, getNodeCoordinates]);

  // Vehicle coordinate & angle interpolation for Screen 2 GPS Map simulation
  const vehiclePosition = useMemo(() => {
    if (!routeResult || routeResult.path.length === 0) {
      return { x: 250, y: 250, angle: 0 };
    }
    const path = routeResult.path;
    if (path.length === 1) {
      const coords = getNodeCoordinates(path[0]);
      return { x: coords.x, y: coords.y, angle: 0 };
    }

    const totalSegments = path.length - 1;
    const segmentProgress = 100 / totalSegments;
    const currentSegmentIndex = Math.min(
      totalSegments - 1,
      Math.floor(navProgress / segmentProgress)
    );

    const startNodeCoords = getNodeCoordinates(path[currentSegmentIndex]);
    const endNodeCoords = getNodeCoordinates(path[currentSegmentIndex + 1]);

    const t = (navProgress - (currentSegmentIndex * segmentProgress)) / segmentProgress;
    const clampT = Math.max(0, Math.min(1, t));

    const x = startNodeCoords.x + (endNodeCoords.x - startNodeCoords.x) * clampT;
    const y = startNodeCoords.y + (endNodeCoords.y - startNodeCoords.y) * clampT;

    const dx = endNodeCoords.x - startNodeCoords.x;
    const dy = endNodeCoords.y - startNodeCoords.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return { x, y, angle };
  }, [routeResult, navProgress, getNodeCoordinates]);

  // Keep state references for requestAnimationFrame loop without triggering re-effects
  const stateRef = useRef({
    color,
    roughness,
    metalness,
    transmission,
    activeLighting,
    autoRotateSpeed,
    showWireframe,
    viewportTheme,
    isNavigating,
    vehiclePosition,
    routeResult,
    cameraFollowTruck,
  });

  // Sync references
  useEffect(() => {
    stateRef.current.color = color;
    stateRef.current.roughness = roughness;
    stateRef.current.metalness = metalness;
    stateRef.current.transmission = transmission;
    stateRef.current.activeLighting = activeLighting;
    stateRef.current.autoRotateSpeed = autoRotateSpeed;
    stateRef.current.showWireframe = showWireframe;
    stateRef.current.viewportTheme = viewportTheme;
    stateRef.current.isNavigating = isNavigating;
    stateRef.current.vehiclePosition = vehiclePosition;
    stateRef.current.routeResult = routeResult;
    stateRef.current.cameraFollowTruck = cameraFollowTruck;
  }, [color, roughness, metalness, transmission, activeLighting, autoRotateSpeed, showWireframe, viewportTheme, isNavigating, vehiclePosition, routeResult, cameraFollowTruck]);

  // Dynamic viewBox for SVG mini-map to zoom fit wayfinding path
  const svgViewBox = useMemo(() => {
    if (!routeResult || routeResult.path.length < 2) {
      return "80 80 640 340";
    }
    
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    
    routeResult.path.forEach(nodeId => {
      const coords = getNodeCoordinates(nodeId);
      if (coords.x < minX) minX = coords.x;
      if (coords.x > maxX) maxX = coords.x;
      if (coords.y < minY) minY = coords.y;
      if (coords.y > maxY) maxY = coords.y;
    });
    
    const w = maxX - minX;
    const h = maxY - minY;
    
    // Add 25% padding around the path
    const padX = Math.max(50, w * 0.25);
    const padY = Math.max(50, h * 0.25);
    
    return `${minX - padX} ${minY - padY} ${w + padX * 2} ${h + padY * 2}`;
  }, [routeResult, getNodeCoordinates]);

  // Determine active turn-by-turn instruction description
  const navigationInstruction = useMemo(() => {
    if (!routeResult) return { main: 'Đang chờ...', sub: '' };
    const baseNodesPath = routeResult.path.filter(id => id in DEFAULT_NODES);
    if (baseNodesPath.length < 2) return { main: 'Đang chờ...', sub: '' };

    const totalSegments = baseNodesPath.length - 1;
    const segmentProgress = 100 / totalSegments;
    const currentSegmentIndex = Math.min(
      totalSegments - 1,
      Math.floor(navProgress / segmentProgress)
    );

    const nextNode = DEFAULT_NODES[baseNodesPath[currentSegmentIndex + 1]];
    const nodeName = nextNode ? nextNode.name.split(' (')[0] : 'Điểm đến';
    
    if (currentSegmentIndex === totalSegments - 1) {
      return {
        main: `Đi thẳng đến ${nodeName}`,
        sub: `Chuẩn bị cập bến tại điểm cuối.`
      };
    } else {
      const nextNextNode = DEFAULT_NODES[baseNodesPath[currentSegmentIndex + 2]];
      const nextNodeName = nextNextNode ? nextNextNode.name.split(' (')[0] : 'Điểm tiếp theo';
      return {
        main: `Tiến về phía ${nodeName}`,
        sub: `Tiếp theo: Rẽ hướng đi ${nextNodeName}`
      };
    }
  }, [routeResult, navProgress, DEFAULT_NODES]);

  // Signature canvas drawing event handlers
  const handleSigMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
  }, []);

  const handleSigMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  }, [isDrawing]);

  const handleSigMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // Touch drawing support for mobile device simulators
  const handleSigTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas || e.touches.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    ctx.beginPath();
    ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    setIsDrawing(true);
  }, []);

  const handleSigTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || e.touches.length === 0) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.stroke();
  }, [isDrawing]);

  const handleSigTouchEnd = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clearSignature = useCallback(() => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const renderAdminStage = (width: number, height: number, isMobile: boolean) => {
    const currentScale = isMobile ? mobileStageScale : stageScale;
    const currentPos = isMobile ? mobileStagePos : stagePos;
    const currentOnWheel = isMobile ? handleMobileWheel : handleWheel;
    
    const findClosestObstacleSlot = (x: number, y: number) => {
      let closestPathId = '';
      let closestPosition: 'start' | 'end' = 'start';
      let minDistance = Infinity;
      
      paths.forEach(path => {
        const fromNode = nodes[path.from];
        const toNode = nodes[path.to];
        if (!fromNode || !toNode) return;
        
        const oxStart = fromNode.x + (toNode.x - fromNode.x) * 0.25;
        const oyStart = fromNode.y + (toNode.y - fromNode.y) * 0.25;
        const oxEnd = fromNode.x + (toNode.x - fromNode.x) * 0.75;
        const oyEnd = fromNode.y + (toNode.y - fromNode.y) * 0.75;
        
        const distStart = Math.hypot(x - oxStart, y - oyStart);
        const distEnd = Math.hypot(x - oxEnd, y - oyEnd);
        
        if (distStart < minDistance) {
          minDistance = distStart;
          closestPathId = path.id;
          closestPosition = 'start';
        }
        if (distEnd < minDistance) {
          minDistance = distEnd;
          closestPathId = path.id;
          closestPosition = 'end';
        }
      });
      
      return { pathId: closestPathId, position: closestPosition };
    };

    const handleDragEnd = (e: any) => {
      const newPos = { x: e.target.x(), y: e.target.y() };
      if (isMobile) {
        setMobileStagePos(newPos);
      } else {
        setStagePos(newPos);
      }
    };

    return (
      <Stage
        width={width}
        height={height}
        scaleX={currentScale.x}
        scaleY={currentScale.y}
        x={currentPos.x}
        y={currentPos.y}
        draggable={true}
        onWheel={currentOnWheel}
        onDragEnd={handleDragEnd}
        onClick={(e) => {
          if (activeTool === 'add_gate') {
            const stage = e.target.getStage();
            if (stage) {
              const pointer = stage.getPointerPosition();
              if (pointer) {
                const stageX = Math.round((pointer.x - stage.x()) / currentScale.x);
                const stageY = Math.round((pointer.y - stage.y()) / currentScale.y);
                const id = 'gate_' + Math.random().toString(36).substr(2, 9);
                const newNode: PortNode = {
                  id,
                  name: `Cổng mới ${id.substr(5, 4).toUpperCase()}`,
                  x: stageX,
                  y: stageY,
                  type: 'gate'
                };
                setNodes(prev => ({ ...prev, [id]: newNode }));
                setSelectedNodeId(id);
                setSelectedPathId(null);
                setSelectedObstacle(null);
                setActiveTool('select');
                setActiveAdminTab('details');
              }
            }
          } else {
            if (e.target === e.target.getStage()) {
              setSelectedNodeId(null);
              setSelectedPathId(null);
              setSelectedObstacle(null);
            }
          }
        }}
        onTap={(e) => {
          if (activeTool === 'add_gate') {
            const stage = e.target.getStage();
            if (stage) {
              const pointer = stage.getPointerPosition();
              if (pointer) {
                const stageX = Math.round((pointer.x - stage.x()) / currentScale.x);
                const stageY = Math.round((pointer.y - stage.y()) / currentScale.y);
                const id = 'gate_' + Math.random().toString(36).substr(2, 9);
                const newNode: PortNode = {
                  id,
                  name: `Cổng mới ${id.substr(5, 4).toUpperCase()}`,
                  x: stageX,
                  y: stageY,
                  type: 'gate'
                };
                setNodes(prev => ({ ...prev, [id]: newNode }));
                setSelectedNodeId(id);
                setSelectedPathId(null);
                setSelectedObstacle(null);
                setActiveTool('select');
                setActiveAdminTab('details');
              }
            }
          } else {
            if (e.target === e.target.getStage()) {
              setSelectedNodeId(null);
              setSelectedPathId(null);
              setSelectedObstacle(null);
            }
          }
        }}
        style={{ cursor: (activeTool === 'obstacle' || activeTool === 'add_gate') ? 'crosshair' : 'grab' }}
      >
        <Layer>
          {paths.map(path => {
            const fNode = DEFAULT_NODES[path.from];
            const tNode = DEFAULT_NODES[path.to];
            if (!fNode || !tNode) return null;
            
            const fromNode = isMobile ? { ...fNode, x: fNode.y, y: fNode.x } : fNode;
            const toNode = isMobile ? { ...tNode, x: tNode.y, y: tNode.x } : tNode;
            
            const isSelected = path.id === selectedPathId;
            const isFullyBlocked = path.obstacleStart && path.obstacleEnd;
            const hasRepair = path.obstacleStart || path.obstacleEnd;

            const polylinePoints = path.points && path.points.length > 0
                ? path.points.reduce((acc: number[], p: number[]) => isMobile ? acc.concat([p[1], p[0]]) : acc.concat([p[0], p[1]]), [])
                : [fromNode.x, fromNode.y, toNode.x, toNode.y];
            
            const midIndex = path.points ? Math.floor(path.points.length / 2) : 0;
            const midX = path.points && path.points.length > 0 ? (isMobile ? path.points[midIndex][1] : path.points[midIndex][0]) : (fromNode.x + toNode.x) / 2;
            const midY = path.points && path.points.length > 0 ? (isMobile ? path.points[midIndex][0] : path.points[midIndex][1]) : (fromNode.y + toNode.y) / 2;

            return (
              <Group key={path.id}>
                <Line
                  points={polylinePoints}
                  stroke={isSelected ? '#a855f7' : isFullyBlocked ? '#ef4444' : hasRepair ? '#f97316' : isMobile ? '#ffffff' : '#38bdf8'}
                  strokeWidth={isMobile ? 8 : (isSelected ? 6 : 4)}
                  shadowColor={isMobile ? "black" : undefined}
                  shadowBlur={isMobile ? 4 : 0}
                  shadowOffset={isMobile ? { x: 2, y: 2 } : { x: 0, y: 0 }}
                  shadowOpacity={isMobile ? 0.5 : 0}
                  dash={isFullyBlocked ? [10, 5] : hasRepair ? [6, 4] : undefined}
                  lineCap="round"
                  onClick={() => setSelectedPathId(path.id)}
                  onTap={() => setSelectedPathId(path.id)}
                />
                
                <KonvaText
                  x={midX - 10}
                  y={midY - 10}
                  text={`${Number(path.weight).toFixed(1)}m`}
                  fontSize={10}
                  fill={isMobile ? '#1e293b' : '#cbd5e1'}
                  fontStyle="bold"
                />

                {(activeTool === 'obstacle' || path.obstacleStart) && (
                  <Group 
                    draggable={!!path.obstacleStart}
                    onDragEnd={(e: any) => {
                      const dx = e.target.x();
                      const dy = e.target.y();
                      e.target.position({ x: 0, y: 0 });
                      e.target.getLayer().batchDraw();
                      
                      const newX = oxStart + dx;
                      const newY = oyStart + dy;
                      
                      const targetSlot = findClosestObstacleSlot(newX, newY);
                      
                      const updatedPaths = paths.map(p => {
                        let obstacleStart = p.obstacleStart;
                        let obstacleEnd = p.obstacleEnd;
                        
                        if (p.id === path.id) {
                          obstacleStart = false;
                        }
                        if (p.id === targetSlot.pathId) {
                          if (targetSlot.position === 'start') {
                            obstacleStart = true;
                          } else {
                            obstacleEnd = true;
                          }
                        }
                        return { ...p, obstacleStart, obstacleEnd };
                      });
                      
                      setPaths(updatedPaths);
                      saveToBackendLazy(nodes, updatedPaths);
                    }}
                    onClick={(e: any) => {
                      e.cancelBubble = true;
                      if (activeTool === 'obstacle') {
                        handleToggleObstacle(path.id, 'start', !path.obstacleStart);
                        if (selectedObstacle?.pathId === path.id && selectedObstacle.position === 'start') {
                          setSelectedObstacle(null);
                        }
                      } else {
                        setSelectedObstacle({ pathId: path.id, position: 'start' });
                        setSelectedPathId(path.id);
                      }
                    }}
                    onTap={(e: any) => {
                      e.cancelBubble = true;
                      if (activeTool === 'obstacle') {
                        handleToggleObstacle(path.id, 'start', !path.obstacleStart);
                        if (selectedObstacle?.pathId === path.id && selectedObstacle.position === 'start') {
                          setSelectedObstacle(null);
                        }
                      } else {
                        setSelectedObstacle({ pathId: path.id, position: 'start' });
                        setSelectedPathId(path.id);
                      }
                    }}
                  >
                    {activeTool === 'obstacle' && !path.obstacleStart && (
                      <Circle
                        x={oxStart}
                        y={oyStart}
                        radius={14}
                        fill="rgba(249, 115, 22, 0.15)"
                        stroke="#f97316"
                        strokeWidth={1}
                        dash={[2, 2]}
                      />
                    )}
                    {path.obstacleStart && (
                      <Group x={oxStart} y={oyStart - 5}>
                        <RegularPolygon
                          sides={3}
                          radius={10}
                          fill={selectedObstacle?.pathId === path.id && selectedObstacle.position === 'start' ? '#a855f7' : '#f97316'}
                          stroke="#000"
                          strokeWidth={selectedObstacle?.pathId === path.id && selectedObstacle.position === 'start' ? 2 : 1}
                        />
                        <Line
                          points={[-8, 7, 8, 7]}
                          stroke="#000"
                          strokeWidth={2.5}
                        />
                      </Group>
                    )}
                  </Group>
                )}

                {(activeTool === 'obstacle' || path.obstacleEnd) && (
                  <Group 
                    draggable={!!path.obstacleEnd}
                    onDragEnd={(e: any) => {
                      const dx = e.target.x();
                      const dy = e.target.y();
                      e.target.position({ x: 0, y: 0 });
                      e.target.getLayer().batchDraw();
                      
                      const newX = oxEnd + dx;
                      const newY = oyEnd + dy;
                      
                      const targetSlot = findClosestObstacleSlot(newX, newY);
                      
                      const updatedPaths = paths.map(p => {
                        let obstacleStart = p.obstacleStart;
                        let obstacleEnd = p.obstacleEnd;
                        
                        if (p.id === path.id) {
                          obstacleEnd = false;
                        }
                        if (p.id === targetSlot.pathId) {
                          if (targetSlot.position === 'start') {
                            obstacleStart = true;
                          } else {
                            obstacleEnd = true;
                          }
                        }
                        return { ...p, obstacleStart, obstacleEnd };
                      });
                      
                      setPaths(updatedPaths);
                      saveToBackendLazy(nodes, updatedPaths);
                    }}
                    onClick={(e: any) => {
                      e.cancelBubble = true;
                      if (activeTool === 'obstacle') {
                        handleToggleObstacle(path.id, 'end', !path.obstacleEnd);
                        if (selectedObstacle?.pathId === path.id && selectedObstacle.position === 'end') {
                          setSelectedObstacle(null);
                        }
                      } else {
                        setSelectedObstacle({ pathId: path.id, position: 'end' });
                        setSelectedPathId(path.id);
                      }
                    }}
                    onTap={(e: any) => {
                      e.cancelBubble = true;
                      if (activeTool === 'obstacle') {
                        handleToggleObstacle(path.id, 'end', !path.obstacleEnd);
                        if (selectedObstacle?.pathId === path.id && selectedObstacle.position === 'end') {
                          setSelectedObstacle(null);
                        }
                      } else {
                        setSelectedObstacle({ pathId: path.id, position: 'end' });
                        setSelectedPathId(path.id);
                      }
                    }}
                  >
                    {activeTool === 'obstacle' && !path.obstacleEnd && (
                      <Circle
                        x={oxEnd}
                        y={oyEnd}
                        radius={14}
                        fill="rgba(249, 115, 22, 0.15)"
                        stroke="#f97316"
                        strokeWidth={1}
                        dash={[2, 2]}
                      />
                    )}
                    {path.obstacleEnd && (
                      <Group x={oxEnd} y={oyEnd - 5}>
                        <RegularPolygon
                          sides={3}
                          radius={10}
                          fill={selectedObstacle?.pathId === path.id && selectedObstacle.position === 'end' ? '#a855f7' : '#f97316'}
                          stroke="#000"
                          strokeWidth={selectedObstacle?.pathId === path.id && selectedObstacle.position === 'end' ? 2 : 1}
                        />
                        <Line
                          points={[-8, 7, 8, 7]}
                          stroke="#000"
                          strokeWidth={2.5}
                        />
                      </Group>
                    )}
                  </Group>
                )}
              </Group>
            );
          })}

          {/* Render active computed route line with animated 2D arrows on Konva Stage */}
          {routeResult && routeResult.path.length >= 2 && (() => {
            const pointsCoords: number[] = [];
            const rawPoints: { x: number; y: number }[] = [];
            
            routeResult.path.forEach(nodeId => {
              const coords = getNodeCoordinates(nodeId);
              const px = isMobile ? coords.y : coords.x;
              const py = isMobile ? coords.x : coords.y;
              pointsCoords.push(px, py);
              rawPoints.push({ x: px, y: py });
            });
            
            const arrows = getRouteArrows(rawPoints, animationOffset, isMobile ? 30 : 40);
            
            return (
              <Group>
                {/* Route Glow Underline */}
                <Line
                  points={pointsCoords}
                  stroke="#38bdf8"
                  strokeWidth={isMobile ? 8 : 6}
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.3}
                />
                {/* Main Route Line */}
                <Line
                  points={pointsCoords}
                  stroke="#38bdf8"
                  strokeWidth={isMobile ? 4 : 3}
                  lineCap="round"
                  lineJoin="round"
                />
                {/* Animated Arrowheads */}
                {arrows.map((arrow, idx) => (
                  <RegularPolygon
                    key={idx}
                    x={arrow.x}
                    y={arrow.y}
                    sides={3}
                    radius={isMobile ? 5 : 4}
                    rotation={arrow.angle + 90}
                    fill="#f97316"
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                ))}
              </Group>
            );
          })()}

          {Object.values(DEFAULT_NODES).map(node => {
            if (!node) return null;
            const mapName = (node.name || '').toLowerCase();
            const matchKey = Object.keys(materialsMap).find(k => mapName.includes(k.toLowerCase())) || 'gate';
            const nodeColor = materialsMap[matchKey] || '#22c55e';
            const fillVal = nodeColor;

            const actX = isMobile ? node.y : node.x;
            const actY = isMobile ? node.x : node.y;

            const isStart = node.id === startNode;
            const isEnd = node.id === endNode;
            const isSelectedNode = node.id === selectedNodeId;

            return (
              <Group 
                key={node.id}
                draggable={true}
                onDragEnd={(e: any) => {
                  const dx = e.target.x();
                  const dy = e.target.y();
                  e.target.position({ x: 0, y: 0 });
                  e.target.getLayer().batchDraw();
                  
                  const newX = isMobile ? Math.round(node.x + dy) : Math.round(node.x + dx);
                  const newY = isMobile ? Math.round(node.y + dx) : Math.round(node.y + dy);
                  
                  const updatedNodes = {
                    ...nodes,
                    [node.id]: {
                      ...node,
                      x: newX,
                      y: newY
                    }
                  };
                  setNodes(updatedNodes);
                  saveToBackendLazy(updatedNodes, paths);
                }}
                onClick={(e: any) => {
                  e.cancelBubble = true;
                  setSelectedNodeId(node.id);
                  setSelectedPathId(null);
                  setSelectedObstacle(null);
                  setActiveAdminTab('details');
                }}
                onTap={(e: any) => {
                  e.cancelBubble = true;
                  setSelectedNodeId(node.id);
                  setSelectedPathId(null);
                  setSelectedObstacle(null);
                  setActiveAdminTab('details');
                }}
              >
                {(isStart || isEnd || isSelectedNode) && (
                  <Circle
                    x={actX}
                    y={actY}
                    radius={18}
                    fill="transparent"
                    stroke={isSelectedNode ? '#3b82f6' : isStart ? '#22c55e' : '#a855f7'}
                    strokeWidth={isSelectedNode ? 3 : 2}
                    dash={isSelectedNode ? undefined : [4, 2]}
                  />
                )}

                <Circle
                  x={actX}
                  y={actY}
                  radius={12}
                  fill={fillVal}
                  stroke={isSelectedNode ? '#3b82f6' : '#fff'}
                  strokeWidth={isSelectedNode ? 2.5 : 1.5}
                  shadowColor="black"
                  shadowBlur={5}
                  shadowOpacity={0.3}
                />
                <KonvaText
                  x={actX - 40}
                  y={actY + 16}
                  width={80}
                  align="center"
                  text={node.name.split(' (')[0]}
                  fontSize={10}
                  fill={isSelectedNode ? '#3b82f6' : fillVal}
                  fontStyle="bold"
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    );
  };

  return (
    <div style={{ ...styles.container, ...(hideControls ? { height: '100%', border: 'none', boxShadow: 'none' } : {}) }}>
      {/* 3D Viewport Column */}
      <div style={styles.viewportContainer}>
        {/* Loading Overlay */}
        {loadingProgress >= 0 && (
          <div style={styles.overlay}>
            <div style={styles.loaderBox}>
              <div style={styles.spinner} />
              <div style={styles.loaderText}>Đang tải mô hình 3D... {loadingProgress}%</div>
            </div>
          </div>
        )}

        {loadingProgress === -2 && (
          <div style={styles.overlay}>
            <div style={styles.errorBox}>
              <span style={{ fontSize: '24px' }}>⚠️</span>
              <div style={styles.loaderText}>Không thể load file Asset 3D</div>
              <div style={{ fontSize: '11px', color: '#fda4af', marginTop: '4px' }}>
                Đảm bảo file được copy vào thư mục public của frontend.
              </div>
            </div>
          </div>
        )}

        {/* Diagnostic FPS Overlay */}
        {!hideControls && (
          <>
            <div style={styles.fpsBadge}>
              🟢 Ready • {fps} FPS
            </div>
            <div id="camera-info-badge" style={styles.infoBadge}>
              CAM: X: 0.00 Y: 1.20 Z: 4.00<br />
              TAR: X: 0.00 Y: 0.00 Z: 0.00
            </div>
            <div style={styles.floatingControls}>
              <button 
                onClick={() => setIsAdminModalOpen(true)}
                style={styles.adminBtn}
                title="Settings"
              >
                ⚙️
              </button>
              <button 
                onClick={() => setViewportTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                style={styles.themeBtn}
              >
                {viewportTheme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
            </div>
          </>
        )}

        {/* 3D Canvas Mount Point */}
        <div ref={mountRef} style={styles.canvasMount} />
      </div>

      {/* Controller Controls Column (including mobile simulator) */}
      {!hideControls && (
        <div style={styles.sidebar}>
          {/* Mobile Device Mockup Full Height */}
          <div style={{
            ...styles.mobileDevice,
            height: '100%',
            minHeight: '100%',
            borderTopWidth: '0px',
            borderLeftWidth: '1px',
            borderColor: '#334155',
            flex: 1,
          }}>
            <div style={styles.mobileScreen}>
              {/* Status Bar */}
              <div style={styles.statusBar}>
                <span>{currentTime}</span>
                <span style={{ fontSize: '10px' }}>📶 🔋</span>
              </div>

              {/* Title Header: Port Navigator */}
              <div style={{
                padding: '8px 16px',
                borderBottom: '1px solid #1e293b',
                backgroundColor: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '8px', fontWeight: 700, color: '#38bdf8' }}>📍 Port Navigator</span>
              </div>

              {/* Map on top half of mobile screen */}
              <div style={{ height: '50vh', width: '100%', borderBottom: '2px solid #1e293b', position: 'relative', overflow: 'hidden', backgroundColor: '#22c55e' }}>
                {renderAdminStage(356, Math.round(window.innerHeight * 0.5), true)}
              </div>

              {/* Screen 1: Route Planning & Overview */}
              {mobileScreen === 'planning' && (
                <div style={styles.appContainer}>


                  {/* Swap inputs design */}
                  <div style={{ ...styles.appForm, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                    <div style={{ ...styles.inputGroup, flex: 1, marginBottom: 0 }}>
                      <label style={styles.appLabel}>From</label>
                      <select 
                        value={startNode} 
                        onChange={(e) => setStartNode(e.target.value)}
                        style={styles.appSelect}
                      >
                        <option value="">---</option>
                        {Object.values(DEFAULT_NODES).map(node => (
                          <option key={node.id} value={node.id}>{getNodeDisplayName(node.id)}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                      <button 
                        onClick={() => {
                          const tmp = startNode;
                          setStartNode(endNode);
                          setEndNode(tmp);
                        }}
                        style={{
                          background: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '50%',
                          width: '28px',
                          height: '28px',
                          color: '#38bdf8',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Swap"
                      >
                        ⇅
                      </button>
                    </div>

                    <div style={{ ...styles.inputGroup, flex: 1, marginBottom: 0 }}>
                      <label style={styles.appLabel}>To</label>
                      <select 
                        value={endNode} 
                        onChange={(e) => setEndNode(e.target.value)}
                        style={styles.appSelect}
                      >
                        <option value="">---</option>
                        {Object.values(DEFAULT_NODES).map(node => (
                          <option key={node.id} value={node.id}>{getNodeDisplayName(node.id)}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Route Summary */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: '#1e293b', borderRadius: '8px', borderLeft: '4px solid #38bdf8', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>ETA:</span>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#f8fafc' }}>
                        🕒 {routeResult ? Math.max(1, Math.round(routeResult.distance / 45)) + ' min' : '---'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Distance:</span>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#38bdf8' }}>
                        {routeResult ? routeResult.distance.toFixed(1) + ' m' : '---'}
                      </span>
                    </div>
                  </div>

                  {/* Route Timeline / Path steps */}
                  <div style={styles.resultArea}>
                    {routeResult ? (
                      <div style={styles.routeDetails}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>
                          Detailed Route:
                        </span>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', paddingLeft: '16px' }}>
                          {/* Timeline vertical line */}
                          <div style={{
                            position: 'absolute',
                            left: '4px',
                            top: '8px',
                            bottom: '8px',
                            width: '2px',
                            backgroundColor: '#38bdf8',
                          }} />

                          {routeResult.path.filter(id => id in DEFAULT_NODES).map((nodeId, idx, arr) => {
                            const node = DEFAULT_NODES[nodeId];
                            const isFirst = idx === 0;
                            const isLast = idx === arr.length - 1;
                            
                            return (
                              <div key={nodeId} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', position: 'relative' }}>
                                {/* Node dot */}
                                <div style={{
                                  position: 'absolute',
                                  left: '-16px',
                                  width: '10px',
                                  height: '10px',
                                  borderRadius: '50%',
                                  backgroundColor: isFirst ? '#22c55e' : isLast ? '#ef4444' : '#cbd5e1',
                                  border: '2px solid #0f172a',
                                  zIndex: 2,
                                }} />
                                
                                <span style={{ fontSize: '12px', fontWeight: (isFirst || isLast) ? 600 : 500, color: (isFirst || isLast) ? '#e2e8f0' : '#94a3b8' }}>
                                  {node.name}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={styles.routeError}>
                        ⚠️ Route not found!<br/>
                        <span style={{ fontSize: '10px', marginTop: '4px', display: 'block', opacity: 0.8 }}>
                          All paths are blocked by obstacles.</span>
                      </div>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {routeResult && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px' }}>
                        <button 
                          onClick={() => {
                            setMobileScreen('navigation');
                            setNavProgress(0);
                            setIsNavigating(true);
                          }}
                          style={styles.appNavigateBtn}
                        >
                          🚀 BẮT ĐẦU ĐIỀU HƯỚNG
                        </button>
                        
                        {/* Simulation Interval Speed Slider */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.5px' }}>TỐC ĐỘ MÔ PHỎNG (Interval)</span>
                            <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 'bold' }}>{navSpeed} ms</span>
                          </div>
                          <input
                            type="range"
                            min="20"
                            max="500"
                            value={navSpeed}
                            onChange={(e) => setNavSpeed(Number(e.target.value))}
                            style={{
                              width: '100%',
                              accentColor: '#38bdf8',
                              background: '#1e293b',
                              height: '4px',
                              borderRadius: '2px',
                              cursor: 'pointer'
                            }}
                          />
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              )}

              {/* Screen 2: Active Turn-by-Turn Navigation */}
              {mobileScreen === 'navigation' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#030712', padding: '32px 0 8px 0', boxSizing: 'border-box' }}>
                  {/* Active Instruction Blue Banner */}
                  <div style={{
                    backgroundColor: '#1e40af',
                    color: '#ffffff',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)',
                    zIndex: 10,
                  }}>
                    {/* Turn Arrow SVG */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: '8px', width: '38px', height: '38px' }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{navigationInstruction.main}</span>
                      <span style={{ fontSize: '11px', color: '#93c5fd' }}>{navigationInstruction.sub}</span>
                    </div>
                  </div>

                  {/* SVG mini-map area with animating navigation triangle */}
                  <div style={{ flex: 1, position: 'relative', backgroundColor: '#090d16', overflow: 'hidden' }}>
                    <svg viewBox={svgViewBox} style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
                      {/* Render all paths in background */}
                      {paths.map(path => {
                        const fromNode = DEFAULT_NODES[path.from];
                        const toNode = DEFAULT_NODES[path.to];
                        const isFullyBlocked = path.obstacleStart && path.obstacleEnd;
                        const hasRepair = path.obstacleStart || path.obstacleEnd;

                        if (hasRepair) {
                          const oxStart = fromNode.x + (toNode.x - fromNode.x) * 0.25;
                          const oyStart = fromNode.y + (toNode.y - fromNode.y) * 0.25;
                          const oxEnd = fromNode.x + (toNode.x - fromNode.x) * 0.75;
                          const oyEnd = fromNode.y + (toNode.y - fromNode.y) * 0.75;

                          return (
                            <g key={path.id}>
                              <line
                                x1={fromNode.x}
                                y1={fromNode.y}
                                x2={oxStart}
                                y2={oyStart}
                                stroke="#334155"
                                strokeWidth={3}
                              />
                              <line
                                x1={oxStart}
                                y1={oyStart}
                                x2={oxEnd}
                                y2={oyEnd}
                                stroke={isFullyBlocked ? '#dc2626' : '#f97316'}
                                strokeWidth={isFullyBlocked ? 2 : 3}
                                strokeDasharray={isFullyBlocked ? '4 4' : '3 3'}
                              />
                              <line
                                x1={oxEnd}
                                y1={oyEnd}
                                x2={toNode.x}
                                y2={toNode.y}
                                stroke="#334155"
                                strokeWidth={3}
                              />
                            </g>
                          );
                        }

                        return (
                          <line
                            key={path.id}
                            x1={fromNode.x}
                            y1={fromNode.y}
                            x2={toNode.x}
                            y2={toNode.y}
                            stroke="#334155"
                            strokeWidth={3}
                          />
                        );
                      })}

                      {/* Render active computed route line with continuous animated 2D arrows on SVG Map */}
                      {routeResult && routeResult.path.length >= 2 && (() => {
                        const points: string[] = [];
                        const rawPoints: { x: number; y: number }[] = [];
                        
                        routeResult.path.forEach(nodeId => {
                          const coords = getNodeCoordinates(nodeId);
                          points.push(`${coords.x},${coords.y}`);
                          rawPoints.push({ x: coords.x, y: coords.y });
                        });
                        
                        const arrows = getRouteArrows(rawPoints, animationOffset, 30);
                        
                        return (
                          <g>
                            {/* Glow polyline */}
                            <polyline
                              points={points.join(' ')}
                              fill="none"
                              stroke="#38bdf8"
                              strokeWidth={8}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              opacity={0.3}
                            />
                            {/* Main polyline */}
                            <polyline
                              points={points.join(' ')}
                              fill="none"
                              stroke="#38bdf8"
                              strokeWidth={4}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {/* SVG Animated Arrowheads */}
                            {arrows.map((arrow, idx) => (
                              <path
                                key={idx}
                                d="M-5,-4 L5,0 L-5,4 Z"
                                fill="#f97316"
                                stroke="#ffffff"
                                strokeWidth={1}
                                transform={`translate(${arrow.x}, ${arrow.y}) rotate(${arrow.angle})`}
                              />
                            ))}
                          </g>
                        );
                      })()}

                      {Object.values(DEFAULT_NODES).map(node => {
                        const isActive = routeResult?.path.includes(node.id);
                        const mapName = (node.name || '').toLowerCase();
                        const matchKey = Object.keys(materialsMap).find(k => mapName.includes(k.toLowerCase())) || 'gate';
                        const nodeColor = materialsMap[matchKey] || '#64748b';
                        return (
                          <circle
                            key={node.id}
                            cx={node.x}
                            cy={node.y}
                            r={isActive ? 6 : 4}
                            fill={node.id === startNode ? '#22c55e' : node.id === endNode ? '#ef4444' : nodeColor}
                            stroke="#000"
                            strokeWidth={1}
                          />
                        );
                      })}

                      {/* Animating Vehicle Navigation Triangle */}
                      {routeResult && (
                        <g transform={`translate(${vehiclePosition.x}, ${vehiclePosition.y}) rotate(${vehiclePosition.angle})`}>
                          <path
                            d="M-8,-6 L10,0 L-8,6 L-4,0 Z"
                            fill="#f97316"
                            stroke="#ffffff"
                            strokeWidth={1.5}
                          />
                        </g>
                      )}
                    </svg>

                    {/* Floating Side Buttons (Mute, Compass, GPS Lock, Settings) */}
                    <div style={{ position: 'absolute', right: '12px', top: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <button 
                        onClick={() => setIsAudioMuted(!isAudioMuted)}
                        style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'rgba(30,41,59,0.85)', border: '1px solid #334155', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      >
                        {isAudioMuted ? '🔇' : '🔊'}
                      </button>
                      <button style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'rgba(30,41,59,0.85)', border: '1px solid #334155', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        🧭
                      </button>
                      <button style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'rgba(30,41,59,0.85)', border: '1px solid #334155', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        ⌖
                      </button>
                    </div>

                    {/* Floating Speed Limit overlay (Bottom-left) */}
                    <div style={{ position: 'absolute', left: '12px', bottom: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', border: '4px solid #ef4444', backgroundColor: '#ffffff', color: '#000000', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                        40
                      </div>
                      <div style={{ backgroundColor: 'rgba(15,23,42,0.85)', border: '1px solid #334155', padding: '4px 6px', borderRadius: '4px', color: '#38bdf8', fontSize: '10px', fontWeight: 'bold', textAlign: 'center' }}>
                        {isNavigating ? '25 km/h' : '0 km/h'}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Navigation Status card */}
                  <div style={{
                    backgroundColor: '#1e293b',
                    borderTop: '1px solid #334155',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    boxShadow: '0 -4px 10px rgba(0,0,0,0.3)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>DỰ KIẾN ĐẾN</span>
                        <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#ffffff' }}>
                          {(() => {
                            const now = new Date();
                            const estMin = routeResult ? Math.max(1, Math.round(routeResult.distance / 45)) : 1;
                            const etaTime = new Date(now.getTime() + (isNavigating ? estMin * (1 - navProgress/100) : 0) * 60000);
                            return `${String(etaTime.getHours()).padStart(2, '0')}:${String(etaTime.getMinutes()).padStart(2, '0')}`;
                          })()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>
                        <span>Còn {routeResult ? Math.max(1, Math.round((routeResult.distance / 45) * (1 - navProgress/100))) : 0} phút</span>
                        <span>•</span>
                        <span>{routeResult ? (routeResult.distance * (1 - navProgress/100)).toFixed(1) : 0} m</span>
                      </div>
                    </div>

                    {/* Camera follow mode control */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', marginBottom: '4px' }}>
                      <input 
                        type="checkbox" 
                        checked={cameraFollowTruck} 
                        onChange={(e) => setCameraFollowTruck(e.target.checked)}
                        style={{ width: '15px', height: '15px', accentColor: '#38bdf8', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 500 }}>
                        🎥 Khóa camera bám theo xe tải (3D Follow)
                      </span>
                    </label>

                    {/* Progress Bar slider */}
                    <div style={{ width: '100%', height: '4px', backgroundColor: '#334155', borderRadius: '2px', overflow: 'hidden', position: 'relative' }}>
                      <div style={{ width: `${navProgress}%`, height: '100%', backgroundColor: '#f97316', transition: 'width 0.12s linear' }} />
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => {
                          setIsNavigating(false);
                          setMobileScreen('planning');
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: '#ef4444',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#ffffff',
                          padding: '10px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                        }}
                      >
                        ✕ HỦY
                      </button>
                      
                      <button
                        onClick={() => {
                          setIsNavigating(false);
                          setMobileScreen('completion');
                        }}
                        style={{
                          flex: 2,
                          backgroundColor: '#22c55e',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#ffffff',
                          padding: '10px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.25)',
                        }}
                      >
                        ✓ ĐÃ ĐẾN NƠI
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Screen 3: Confirm Arrival & Task Status */}
              {mobileScreen === 'completion' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#090d16', padding: '32px 16px 12px 16px', boxSizing: 'border-box', overflowY: 'auto' }}>
                  {/* Completion header */}
                  <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: '12px', marginBottom: '16px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#f8fafc' }}>Trạng Thái Điểm Đến</span>
                    <button 
                      onClick={() => setMobileScreen('navigation')}
                      style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: '11px' }}
                    >
                      Quay lại
                    </button>
                  </div>

                  {/* Visit Status Buttons GRID (Done, Skipped, Failed) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '16px' }}>
                    <button
                      onClick={() => setVisitStatus('failed')}
                      style={{
                        padding: '12px 6px',
                        borderRadius: '8px',
                        backgroundColor: '#1e293b',
                        border: visitStatus === 'failed' ? '2px solid #ef4444' : '1px solid #334155',
                        color: visitStatus === 'failed' ? '#ef4444' : '#94a3b8',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>✕</span>
                      <span>THẤT BẠI</span>
                    </button>
                    <button
                      onClick={() => setVisitStatus('skipped')}
                      style={{
                        padding: '12px 6px',
                        borderRadius: '8px',
                        backgroundColor: '#1e293b',
                        border: visitStatus === 'skipped' ? '2px solid #eab308' : '1px solid #334155',
                        color: visitStatus === 'skipped' ? '#eab308' : '#94a3b8',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>↶</span>
                      <span>BỎ QUA</span>
                    </button>
                    <button
                      onClick={() => setVisitStatus('done')}
                      style={{
                        padding: '12px 6px',
                        borderRadius: '8px',
                        backgroundColor: '#1e293b',
                        border: visitStatus === 'done' ? '2px solid #22c55e' : '1px solid #334155',
                        color: visitStatus === 'done' ? '#22c55e' : '#94a3b8',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>✓</span>
                      <span>HOÀN THÀNH</span>
                    </button>
                  </div>

                  {/* Optional Tasks Checklist */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                    {/* Notes field */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={styles.appLabel}>📝 Ghi chú (Notes)</label>
                      <textarea
                        value={visitNotes}
                        onChange={(e) => setVisitNotes(e.target.value)}
                        placeholder="Nhập ghi chú giao nhận hàng hoặc lý do..."
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px solid #1e293b',
                          borderRadius: '6px',
                          padding: '8px',
                          color: '#cbd5e1',
                          fontSize: '12px',
                          height: '60px',
                          resize: 'none',
                          outline: 'none',
                        }}
                      />
                    </div>

                    {/* Interactive Signature block */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={styles.appLabel}>✍️ Ký xác nhận (Signature)</label>
                        <button 
                          onClick={clearSignature}
                          style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '10px', cursor: 'pointer' }}
                        >
                          Xóa
                        </button>
                      </div>
                      <canvas
                        ref={sigCanvasRef}
                        width={324}
                        height={100}
                        onMouseDown={handleSigMouseDown}
                        onMouseMove={handleSigMouseMove}
                        onMouseUp={handleSigMouseUp}
                        onMouseLeave={handleSigMouseUp}
                        onTouchStart={handleSigTouchStart}
                        onTouchMove={handleSigTouchMove}
                        onTouchEnd={handleSigTouchEnd}
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px dashed #334155',
                          borderRadius: '8px',
                          cursor: 'crosshair',
                          touchAction: 'none',
                        }}
                      />
                    </div>

                    {/* Photo checklist area */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={styles.appLabel}>📷 Ảnh chụp hiện trường</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {/* Camera upload placeholder slot */}
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '8px',
                          border: '1px dashed #334155',
                          backgroundColor: '#0f172a',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#64748b',
                          fontSize: '20px',
                          cursor: 'pointer',
                        }}>
                          +
                        </div>
                        {/* Fake photo thumbnails */}
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid #1e293b',
                          position: 'relative',
                        }}>
                          <div style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: '#1e293b',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '18px',
                          }}>
                            🚢
                          </div>
                        </div>
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid #1e293b',
                          position: 'relative',
                        }}>
                          <div style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: '#1e293b',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '18px',
                          }}>
                            📦
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Confirm Submission green button */}
                  <button
                    onClick={() => {
                      alert(`Đã gửi xác nhận: ${visitStatus.toUpperCase()}\nGhi chú: ${visitNotes}`);
                      setVisitNotes('');
                      clearSignature();
                      setMobileScreen('planning');
                    }}
                    style={{
                      backgroundColor: '#22c55e',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#ffffff',
                      padding: '12px',
                      fontSize: '13px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      marginTop: '16px',
                      boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.25)',
                    }}
                  >
                    XÁC NHẬN HOÀN THÀNH
                  </button>
                </div>
              )}

              {/* Home Indicator */}
              <div style={styles.homeIndicator} />
            </div>
          </div>
        </div>
      )}

      {/* Admin Modal */}
      {isAdminModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContainer}>
            {/* Modal Header */}
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Bản đồ Quản lý Cảng & Điều phối Tuyến đường (2D Map Editor)</h2>
              <button onClick={() => setIsAdminModalOpen(false)} style={styles.modalCloseBtn}>
                ✕
              </button>
            </div>
            
            {/* Modal Body */}
            <div style={styles.modalBody}>
              {/* Left Column: Admin Control Panel */}
              <div style={styles.modalSidebar}>
                <h3 style={styles.modalSidebarTitle}>Công cụ & Trạng thái</h3>
                
                {/* Tool Selector */}
                <div style={styles.modalToolGroup}>
                  <label style={styles.label}>Chế độ thao tác</label>
                  <div style={styles.presetsGrid}>
                    <button
                      style={{ ...styles.presetBtn, ...(activeTool === 'select' ? styles.presetBtnActive : {}) }}
                      onClick={() => {
                        setActiveTool('select');
                        setSelectedObstacle(null);
                        setSelectedNodeId(null);
                        setSelectedPathId(null);
                      }}
                    >
                      🔍 Chọn / Xem
                    </button>
                    <button
                      style={{ ...styles.presetBtn, ...(activeTool === 'obstacle' ? styles.presetBtnActive : {}) }}
                      onClick={() => {
                        setActiveTool('obstacle');
                        setSelectedObstacle(null);
                        setSelectedNodeId(null);
                        setSelectedPathId(null);
                      }}
                    >
                      🚧 Đặt Vật Cản
                    </button>
                    <button
                      style={{ ...styles.presetBtn, ...(activeTool === 'add_gate' ? styles.presetBtnActive : {}) }}
                      onClick={() => {
                        setActiveTool('add_gate');
                        setSelectedObstacle(null);
                        setSelectedNodeId(null);
                        setSelectedPathId(null);
                      }}
                    >
                      📍 Thêm Cổng/Nút
                    </button>
                  </div>
                </div>

                {/* Tabs Selector */}
                <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', marginBottom: '12px' }}>
                  <button 
                    onClick={() => setActiveAdminTab('details')}
                    style={{ flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600, border: 'none', backgroundColor: activeAdminTab === 'details' ? '#1e293b' : 'transparent', color: activeAdminTab === 'details' ? '#38bdf8' : '#94a3b8', cursor: 'pointer' }}
                  >
                    Chi tiết
                  </button>
                  <button 
                    onClick={() => setActiveAdminTab('gates')}
                    style={{ flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600, border: 'none', backgroundColor: activeAdminTab === 'gates' ? '#1e293b' : 'transparent', color: activeAdminTab === 'gates' ? '#38bdf8' : '#94a3b8', cursor: 'pointer' }}
                  >
                    Gates
                  </button>
                  <button 
                    onClick={() => setActiveAdminTab('paths')}
                    style={{ flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600, border: 'none', backgroundColor: activeAdminTab === 'paths' ? '#1e293b' : 'transparent', color: activeAdminTab === 'paths' ? '#38bdf8' : '#94a3b8', cursor: 'pointer' }}
                  >
                    Tuyến
                  </button>
                  <button 
                    onClick={() => setActiveAdminTab('environment')}
                    style={{ flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600, border: 'none', backgroundColor: activeAdminTab === 'environment' ? '#1e293b' : 'transparent', color: activeAdminTab === 'environment' ? '#38bdf8' : '#94a3b8', cursor: 'pointer' }}
                  >
                    3D Config
                  </button>
                </div>

                {/* Selected Details Tab */}
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                  {activeAdminTab === 'details' && (
                    selectedObstacle ? (() => {
                      const path = paths.find(p => p.id === selectedObstacle.pathId);
                      if (!path) return null;
                      const fromNode = DEFAULT_NODES[path.from];
                      const toNode = DEFAULT_NODES[path.to];
                      const targetNode = selectedObstacle.position === 'start' ? fromNode : toNode;
                      
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#f97316' }}>
                            🚧 VẬT CẢN ĐANG CHỌN
                          </div>
                          <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.4 }}>
                            Vị trí: Gần <strong>{targetNode.name.split(' (')[0]}</strong> trên tuyến {fromNode.name.split(' (')[0]} ⟷ {toNode.name.split(' (')[0]}
                          </div>
                          <button
                            onClick={() => {
                              handleToggleObstacle(selectedObstacle.pathId, selectedObstacle.position, false);
                              setSelectedObstacle(null);
                            }}
                            style={{
                              backgroundColor: '#ef4444',
                              border: 'none',
                              borderRadius: '8px',
                              color: '#ffffff',
                              padding: '12px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.25)',
                            }}
                          >
                            🗑️ XÓA VẬT CẢN
                          </button>
                        </div>
                      );
                    })() : selectedNodeId ? (() => {
                      const node = nodes[selectedNodeId];
                      if (!node) return null;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8' }}>
                            📍 CỔNG / NÚT ĐANG CHỌN
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={styles.appLabel}>Tên Cổng / Nút</label>
                            <input
                              type="text"
                              value={node.name}
                              onChange={(e) => {
                                const newName = e.target.value;
                                setNodes(prev => ({
                                  ...prev,
                                  [node.id]: { ...prev[node.id], name: newName }
                                }));
                              }}
                              style={styles.adminInput}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={styles.appLabel}>Loại điểm</label>
                            <select
                              value={node.type}
                              onChange={(e) => {
                                const newType = e.target.value as any;
                                setNodes(prev => ({
                                  ...prev,
                                  [node.id]: { ...prev[node.id], type: newType }
                                }));
                              }}
                              style={styles.adminInput}
                            >
                              <option value="gate">Cổng (gate)</option>
                              <option value="weigh_station">Trạm cân (weigh_station)</option>
                              <option value="yard">Cẩu bãi (yard)</option>
                              <option value="storage">Kho hàng (storage)</option>
                              <option value="pier">Cầu cảng (pier)</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={styles.appLabel}>Tọa độ X</label>
                              <input
                                type="number"
                                value={node.x}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10) || 0;
                                  setNodes(prev => ({
                                    ...prev,
                                    [node.id]: { ...prev[node.id], x: val }
                                  }));
                                }}
                                style={styles.adminInput}
                              />
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={styles.appLabel}>Tọa độ Y</label>
                              <input
                                type="number"
                                value={node.y}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10) || 0;
                                  setNodes(prev => ({
                                    ...prev,
                                    [node.id]: { ...prev[node.id], y: val }
                                  }));
                                }}
                                style={styles.adminInput}
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setNodes(prev => {
                                const updated = { ...prev };
                                delete updated[node.id];
                                return updated;
                              });
                              setPaths(prev => prev.filter(p => p.from !== node.id && p.to !== node.id));
                              setSelectedNodeId(null);
                            }}
                            style={{
                              backgroundColor: '#ef4444',
                              border: 'none',
                              borderRadius: '8px',
                              color: '#ffffff',
                              padding: '12px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              marginTop: '6px',
                              boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.25)',
                            }}
                          >
                            🗑️ XÓA CỔNG / NÚT
                          </button>
                        </div>
                      );
                    })() : selectedPathId ? (() => {
                      const path = paths.find(p => p.id === selectedPathId);
                      if (!path) return null;
                      const fromNode = DEFAULT_NODES[path.from];
                      const toNode = DEFAULT_NODES[path.to];
                      const isFullyBlocked = path.obstacleStart && path.obstacleEnd;

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8' }}>
                            Tuyến: {fromNode?.name.split(' (')[0]} ⟷ {toNode?.name.split(' (')[0]}
                          </div>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span>Khoảng cách:</span>
                            <span style={{ fontWeight: 600 }}>{path.weight}m</span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span>Trạng thái:</span>
                            <span style={{ 
                              fontWeight: 600, 
                              color: isFullyBlocked ? '#ef4444' : (path.obstacleStart || path.obstacleEnd) ? '#f97316' : '#22c55e'
                            }}>
                              {isFullyBlocked ? '🔴 Đã chặn' : (path.obstacleStart || path.obstacleEnd) ? '🟡 Cảnh báo' : '🟢 Hoạt động (Open)'}
                            </span>
                          </div>

                          {/* Obstacles Placement Controls */}
                          <div style={{ backgroundColor: 'rgba(30, 41, 59, 0.5)', border: '1px solid #1e293b', padding: '12px', borderRadius: '8px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                            <span style={{ fontWeight: 600, color: '#cbd5e1' }}>Đặt vật cản cảnh báo:</span>
                            <label style={styles.labelCheckbox}>
                              <input
                                type="checkbox"
                                checked={path.obstacleStart}
                                onChange={(e) => {
                                  handleToggleObstacle(path.id, 'start', e.target.checked);
                                  const currentObs = selectedObstacle as any;
                                  if (!e.target.checked && currentObs?.pathId === path.id && currentObs?.position === 'start') {
                                    setSelectedObstacle(null);
                                  }
                                }}
                                style={styles.checkbox}
                              />
                              Vật cản phía {fromNode?.name.split(' (')[0]}
                            </label>
                            <label style={styles.labelCheckbox}>
                              <input
                                type="checkbox"
                                checked={path.obstacleEnd}
                                onChange={(e) => {
                                  handleToggleObstacle(path.id, 'end', e.target.checked);
                                  const currentObs = selectedObstacle as any;
                                  if (!e.target.checked && currentObs?.pathId === path.id && currentObs?.position === 'end') {
                                    setSelectedObstacle(null);
                                  }
                                }}
                                style={styles.checkbox}
                              />
                              Vật cản phía {toNode?.name.split(' (')[0]}
                            </label>
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', marginTop: '24px' }}>
                        Chọn một tuyến đường hoặc vật cản để cấu hình.
                      </div>
                    )
                  )}

                  {/* Gates Management Tab */}
                  {activeAdminTab === 'gates' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>DANH SÁCH CỔNG GATES</div>
                      <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #1e293b', borderRadius: '6px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {Object.values(nodes).map(node => (
                          <div key={node.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
                            <span>{node.name.split(' (')[0]} ({node.x}, {node.y})</span>
                            <button 
                              onClick={() => {
                                setNodes(prev => {
                                  const updated = { ...prev };
                                  delete updated[node.id];
                                  return updated;
                                });
                                setPaths(prev => prev.filter(p => p.from !== node.id && p.to !== node.id));
                              }}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                            >
                              🗑️
                            </button>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1e293b', paddingTop: '10px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600 }}>Thêm Gate Mới</div>
                        <input 
                          placeholder="Tên Gate (ví dụ: Cổng C)" 
                          value={newGateName} 
                          onChange={e => setNewGateName(e.target.value)}
                          style={styles.adminInput}
                        />
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input 
                            placeholder="X coord" 
                            type="number"
                            value={newGateX} 
                            onChange={e => setNewGateX(e.target.value)}
                            style={{ ...styles.adminInput, flex: 1 }}
                          />
                          <input 
                            placeholder="Y coord" 
                            type="number"
                            value={newGateY} 
                            onChange={e => setNewGateY(e.target.value)}
                            style={{ ...styles.adminInput, flex: 1 }}
                          />
                        </div>
                        <select 
                          value={newGateType} 
                          onChange={e => setNewGateType(e.target.value as any)}
                          style={styles.adminInput}
                        >
                          <option value="gate">Cổng (gate)</option>
                          <option value="weigh_station">Trạm cân (weigh_station)</option>
                          <option value="yard">Cẩu bãi (yard)</option>
                          <option value="storage">Kho hàng (storage)</option>
                          <option value="pier">Cầu cảng (pier)</option>
                        </select>
                        <button onClick={handleAddGate} style={styles.adminActionBtn}>
                          ➕ Thêm Gate
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Paths Management Tab */}
                            {activeAdminTab === 'environment' && (
            <div style={{ marginTop: '16px' }}>
              <div style={styles.controlGroup}>
                <label style={styles.label}>Preset Ánh sáng</label>
                <div style={styles.presetsGrid}>
                  {Object.keys(LIGHTS).map((key) => (
                    <button
                      key={key}
                      style={{ ...styles.presetBtn, ...(activeLighting === key ? styles.presetBtnActive : {}) }}
                      onClick={() => setActiveLighting(key)}
                    >
                      💡 {key.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div style={styles.toggleRow}>
                <label style={styles.labelCheckbox}>
                  <input
                    type="checkbox"
                    checked={showWireframe}
                    onChange={(e) => setShowWireframe(e.target.checked)}
                    style={styles.checkbox}
                  />
                  Hiển thị khung lưới (Wireframe)
                </label>
              </div>
              <div style={{ ...styles.controlGroup, marginTop: '16px' }}>
                <label style={styles.label}>Cấu hình material.json</label>
                <textarea
                  value={materialsJsonStr}
                  onChange={(e) => setMaterialsJsonStr(e.target.value)}
                  style={{ width: '100%', height: '150px', backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155', borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace' }}
                />
                <button
                  style={{ ...styles.adminActionBtn, marginTop: '8px', width: '100%' }}
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(materialsJsonStr);
                      
                      fetch('/api/material', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(parsed)
                      })
                      .then(res => {
                        if (!res.ok) throw new Error('Không thể ghi file cấu hình');
                        return res.json();
                      })
                      .then(() => {
                        setMaterialsMap(parsed);
                        alert('Đã lưu cấu hình màu vật liệu và áp dụng thành công!');
                      })
                      .catch(err => {
                        console.error(err);
                        alert('Lỗi lưu file: ' + err.message);
                      });
                    } catch (err) {
                      alert('JSON không hợp lệ. Vui lòng kiểm tra lại!');
                    }
                  }}
                >
                  Áp dụng Material Config
                </button>
              </div>
            </div>
          )}

          {activeAdminTab === 'paths' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>DANH SÁCH TUYẾN ĐƯỜNG</div>
                      <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #1e293b', borderRadius: '6px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {paths.map(path => {
                          const fromName = nodes[path.from]?.name.split(' (')[0] || path.from;
                          const toName = nodes[path.to]?.name.split(' (')[0] || path.to;
                          return (
                            <div key={path.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
                              <span>{fromName} ⟷ {toName} ({path.weight}m)</span>
                              <button 
                                onClick={() => setPaths(prev => prev.filter(p => p.id !== path.id))}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                              >
                                🗑️
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1e293b', paddingTop: '10px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600 }}>Thêm Tuyến Đường Mới</div>
                        <select 
                          value={newPathFrom} 
                          onChange={e => setNewPathFrom(e.target.value)}
                          style={styles.adminInput}
                        >
                          <option value="">-- Chọn điểm đầu --</option>
                          {Object.values(nodes).map(node => (
                            <option key={node.id} value={node.id}>{getNodeDisplayName(node.id)}</option>
                          ))}
                        </select>
                        <select 
                          value={newPathTo} 
                          onChange={e => setNewPathTo(e.target.value)}
                          style={styles.adminInput}
                        >
                          <option value="">-- Chọn điểm cuối --</option>
                          {Object.values(nodes).map(node => (
                            <option key={node.id} value={node.id}>{getNodeDisplayName(node.id)}</option>
                          ))}
                        </select>
                        <input 
                          placeholder="Khoảng cách (m)" 
                          type="number"
                          value={newPathWeight} 
                          onChange={e => setNewPathWeight(e.target.value)}
                          style={styles.adminInput}
                        />
                        <button onClick={handleAddPath} style={styles.adminActionBtn}>
                          ➕ Kết Nối Đường
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Save to Backend Button */}
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '12px', marginTop: '12px' }}>
                  <button 
                    onClick={handleSaveToBackend}
                    style={{
                      width: '100%',
                      backgroundColor: '#22c55e',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#ffffff',
                      padding: '12px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.25)',
                    }}
                  >
                    💾 LƯU BẢN ĐỒ LÊN BACKEND
                  </button>
                </div>
              </div>
              
              {/* Right Column: 2D Interactive Map Canvas */}
              <div ref={canvasContainerRef} style={styles.modalCanvasContainer}>
                {/* Canvas Zoom & Pan Help Controls */}
                <div style={styles.canvasControls}>
                  <button onClick={handleZoomIn} style={styles.canvasBtn} title="Phóng to">+</button>
                  <button onClick={handleZoomOut} style={styles.canvasBtn} title="Thu nhỏ">-</button>
                  <button onClick={handleResetZoom} style={styles.canvasBtn} title="Đặt lại">🏠</button>
                  <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px', alignSelf: 'center' }}>
                    Kéo bản đồ để di chuyển (Pan) • Cuộn chuột để Phóng to/Thu nhỏ (Zoom)
                  </span>
                </div>
                
                {/* React Konva Stage */}
                <div style={{ width: '100%', height: '100%', backgroundColor: '#22c55e' }}>
                  {renderAdminStage(canvasSize.width, canvasSize.height, true)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- CSS styles in JS for clean self-containment ---
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'row',
    width: '100%',
    height: '100vh',
    backgroundColor: '#090d16',
    overflow: 'hidden',
    color: '#f8fafc',
  },
  viewportContainer: {
    flex: 1,
    position: 'relative',
    height: '100%',
    backgroundColor: '#0f172a',
    overflow: 'hidden',
  },
  mobileDevice: {
    width: '380px',
    height: '710px',
    minWidth: '380px',
    minHeight: '710px',
    backgroundColor: '#090d16',
    borderTopStyle: 'solid',
    borderTopColor: '#1e293b',
    borderLeftStyle: 'solid',
    borderLeftColor: '#1e293b',
    borderRadius: '24px 0 0 0',
    boxShadow: '-10px -10px 30px rgba(0, 0, 0, 0.5)',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  mobileScreen: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  statusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '32px',
    padding: '0 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '11px',
    fontWeight: 500,
    color: '#cbd5e1',
    zIndex: 20,
    background: 'linear-gradient(to bottom, rgba(15, 23, 42, 0.8), rgba(15, 23, 42, 0))',
    pointerEvents: 'none',
  },
  homeIndicator: {
    position: 'absolute',
    bottom: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '120px',
    height: '4px',
    backgroundColor: '#cbd5e1',
    borderRadius: '2px',
    zIndex: 20,
    pointerEvents: 'none',
  },
  mobileSpeaker: {
    position: 'absolute',
    top: '4px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '60px',
    height: '12px',
    backgroundColor: '#1e293b',
    borderRadius: '6px',
    zIndex: 30,
  },
  canvasMount: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  loaderBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    textAlign: 'center',
    padding: '24px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid rgba(14, 165, 233, 0.2)',
    borderTop: '3px solid #0ea5e9',
    borderRadius: '50%',
  },
  loaderText: {
    fontSize: '13px',
    color: '#e2e8f0',
    fontWeight: 500,
  },
  fpsBadge: {
    position: 'absolute',
    top: '40px',
    left: '12px',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '20px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#34d399',
    pointerEvents: 'none',
    zIndex: 5,
  },
  infoBadge: {
    position: 'absolute',
    top: '70px',
    left: '12px',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '10px',
    fontWeight: 500,
    color: '#94a3b8',
    pointerEvents: 'none',
    zIndex: 5,
    fontFamily: 'monospace',
    lineHeight: '1.4',
  },
  adminBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '20px',
    padding: '6px 14px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#e2e8f0',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
    zIndex: 5,
    fontFamily: 'sans-serif',
    transition: 'all 0.2s',
  },
  floatingControls: {
    position: 'absolute',
    bottom: '12px',
    left: '12px',
    display: 'flex',
    gap: '8px',
    zIndex: 5,
  },
  themeBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '20px',
    padding: '6px 14px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#e2e8f0',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
    zIndex: 5,
    fontFamily: 'sans-serif',
    transition: 'all 0.2s',
  },
  adminInput: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '6px',
    padding: '8px',
    color: '#cbd5e1',
    fontSize: '12px',
    outline: 'none',
  },
  adminActionBtn: {
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '6px',
    color: '#ffffff',
    padding: '10px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center',
    marginTop: '4px',
  },
  sidebar: {
    width: '380px',
    backgroundColor: '#0f172a',
    borderLeft: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  sidebarInner: {
    width: '100%',
    height: '100%',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  sidebarTitle: {
    fontSize: '16px',
    fontWeight: 700,
    margin: 0,
    marginBottom: '8px',
    background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  presetsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '6px',
    marginTop: '4px',
  },
  presetBtn: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '11px',
    color: '#cbd5e1',
    cursor: 'pointer',
    textAlign: 'center',
    fontWeight: 500,
    transition: 'all 0.15s ease',
  },
  presetBtnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
    color: '#ffffff',
    boxShadow: '0 0 10px rgba(56, 189, 248, 0.25)',
  },
  sliderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderVal: {
    fontSize: '12px',
    color: '#38bdf8',
    fontWeight: 600,
  },
  rangeInput: {
    width: '100%',
    accentColor: '#38bdf8',
    cursor: 'pointer',
  },
  colorPicker: {
    width: '100%',
    height: '36px',
    padding: 0,
    border: '1px solid #334155',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    marginTop: '6px',
  },
  labelCheckbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    cursor: 'pointer',
    color: '#cbd5e1',
  },
  checkbox: {
    accentColor: '#38bdf8',
    cursor: 'pointer',
  },
  // --- New App and Modal Styles ---
  appContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: '40px 16px 20px 16px',
    backgroundColor: '#090d16',
    boxSizing: 'border-box',
  },
  appHeader: {
    paddingBottom: '12px',
    borderBottom: '1px solid #1e293b',
    marginBottom: '16px',
    textAlign: 'center',
    color: '#38bdf8',
  },
  appForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '16px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  appLabel: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  appSelect: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '6px',
    padding: '8px',
    color: '#cbd5e1',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer',
  },
  resultArea: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    border: '1px solid #1e293b',
    padding: '12px',
    marginBottom: '16px',
    overflowY: 'auto',
  },
  routeDetails: {
    display: 'flex',
    flexDirection: 'column',
  },
  routeSteps: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    marginTop: '6px',
  },
  routeStepBadge: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#e2e8f0',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 600,
    width: '100%',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  routeArrow: {
    color: '#38bdf8',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  routeError: {
    color: '#ef4444',
    fontSize: '12px',
    textAlign: 'center',
    paddingTop: '20px',
    fontWeight: 500,
  },
  appAdminBtn: {
    backgroundColor: '#a855f7',
    border: 'none',
    borderRadius: '6px',
    padding: '10px',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center',
    boxShadow: '0 4px 6px -1px rgba(168, 85, 247, 0.2)',
    transition: 'background-color 0.2s ease',
  },
  appNavigateBtn: {
    backgroundColor: '#38bdf8',
    border: 'none',
    borderRadius: '8px',
    padding: '12px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'center',
    boxShadow: '0 4px 6px -1px rgba(56, 189, 248, 0.35)',
    transition: 'background-color 0.2s ease',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  modalContainer: {
    width: '90vw',
    height: '90vh',
    backgroundColor: '#090d16',
    borderRadius: '16px',
    border: '1px solid #1e293b',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    color: '#f8fafc',
  },
  modalHeader: {
    padding: '16px 20px',
    backgroundColor: '#0f172a',
    borderBottom: '1px solid #1e293b',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxSizing: 'border-box',
  },
  modalTitle: {
    fontSize: '16px',
    fontWeight: 700,
    margin: 0,
    background: 'linear-gradient(90deg, #38bdf8, #a855f7)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  modalCloseBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.2s ease',
  },
  modalBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'row',
    height: 'calc(100% - 53px)',
  },
  modalSidebar: {
    width: '320px',
    backgroundColor: '#0f172a',
    borderRight: '1px solid #1e293b',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    boxSizing: 'border-box',
  },
  modalSidebarTitle: {
    fontSize: '14px',
    fontWeight: 600,
    margin: 0,
    color: '#cbd5e1',
  },
  modalToolGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  modalCanvasContainer: {
    flex: 1,
    position: 'relative',
    height: '100%',
    backgroundColor: '#030712',
    display: 'flex',
    flexDirection: 'column',
  },
  canvasControls: {
    position: 'absolute',
    top: '12px',
    left: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    zIndex: 10,
    pointerEvents: 'auto',
  },
  canvasBtn: {
    width: '28px',
    height: '28px',
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '6px',
    color: '#cbd5e1',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  }
};
