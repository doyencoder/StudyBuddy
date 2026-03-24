type MindmapBranchColor = {
  fill: string;
  text: string;
  edge: string;
};

type MindmapPalette = {
  rootFill: string;
  rootText: string;
  branches: MindmapBranchColor[];
};

const MINDMAP_PALETTES: MindmapPalette[] = [
  {
    rootFill: "#f4d35e",
    rootText: "#1f2937",
    branches: [
      { fill: "#00bcd4", text: "#ecfeff", edge: "#67e8f9" },
      { fill: "#3b82f6", text: "#eff6ff", edge: "#93c5fd" },
      { fill: "#8b5cf6", text: "#f5f3ff", edge: "#c4b5fd" },
      { fill: "#ec4899", text: "#fdf2f8", edge: "#f9a8d4" },
      { fill: "#f97316", text: "#fff7ed", edge: "#fdba74" },
      { fill: "#ef4444", text: "#fef2f2", edge: "#fca5a5" },
    ],
  },
  {
    rootFill: "#a7f3d0",
    rootText: "#052e2b",
    branches: [
      { fill: "#0f766e", text: "#ecfeff", edge: "#5eead4" },
      { fill: "#2563eb", text: "#eff6ff", edge: "#93c5fd" },
      { fill: "#7c3aed", text: "#f5f3ff", edge: "#c4b5fd" },
      { fill: "#db2777", text: "#fdf2f8", edge: "#f9a8d4" },
      { fill: "#ea580c", text: "#fff7ed", edge: "#fdba74" },
      { fill: "#65a30d", text: "#f7fee7", edge: "#bef264" },
    ],
  },
  {
    rootFill: "#fbcfe8",
    rootText: "#4a044e",
    branches: [
      { fill: "#7c2d12", text: "#fff7ed", edge: "#fdba74" },
      { fill: "#b91c1c", text: "#fef2f2", edge: "#fca5a5" },
      { fill: "#be185d", text: "#fdf2f8", edge: "#f9a8d4" },
      { fill: "#6d28d9", text: "#f5f3ff", edge: "#c4b5fd" },
      { fill: "#1d4ed8", text: "#eff6ff", edge: "#93c5fd" },
      { fill: "#0f766e", text: "#ecfeff", edge: "#67e8f9" },
    ],
  },
  {
    rootFill: "#bfdbfe",
    rootText: "#172554",
    branches: [
      { fill: "#1d4ed8", text: "#eff6ff", edge: "#93c5fd" },
      { fill: "#0891b2", text: "#ecfeff", edge: "#67e8f9" },
      { fill: "#0f766e", text: "#ecfdf5", edge: "#6ee7b7" },
      { fill: "#65a30d", text: "#f7fee7", edge: "#bef264" },
      { fill: "#ca8a04", text: "#fefce8", edge: "#fde047" },
      { fill: "#f97316", text: "#fff7ed", edge: "#fdba74" },
    ],
  },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isMindmapCode(code: string): boolean {
  return /^\s*(?:%%\{.*?}%%\s*)*mindmap\b/s.test(code);
}

function buildThemeVariables(palette: MindmapPalette) {
  const variables: Record<string, string | number | boolean> = {
    darkMode: true,
    background: "transparent",
    primaryColor: palette.rootFill,
    primaryTextColor: palette.rootText,
    lineColor: palette.branches[0].edge,
    edgeLabelBackground: "#151821",
    git0: palette.rootFill,
    gitBranchLabel0: palette.rootText,
    THEME_COLOR_LIMIT: 12,
  };

  for (let index = 0; index < 12; index += 1) {
    const branch = palette.branches[index % palette.branches.length];
    variables[`cScale${index}`] = branch.fill;
    variables[`cScaleLabel${index}`] = branch.text;
    variables[`cScaleInv${index}`] = branch.edge;
    variables[`lineColor${index}`] = branch.edge;
  }

  return variables;
}

export function withMindmapTheme(mermaidCode: string, seed: string): string {
  if (!isMindmapCode(mermaidCode) || /%%\{init:/s.test(mermaidCode)) {
    return mermaidCode;
  }

  const palette = MINDMAP_PALETTES[hashString(seed) % MINDMAP_PALETTES.length];
  const initDirective = {
    theme: "base",
    themeVariables: buildThemeVariables(palette),
    mindmap: { padding: 16 },
  };

  return `%%{init: ${JSON.stringify(initDirective)}}%%\n${mermaidCode}`;
}
