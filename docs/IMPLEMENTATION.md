# Leaflet.TrackReplay — 实现指南

> 基于《时间轴对齐的批量数据回放系统 核心设计》的技术实现方案

## 架构总览

```
L.TrackReplay (主入口 / 门面)
├── L.TrackReplay.Core
│   ├── DataParser      — GeoJSON 解析、TimestampEdgeoJSON 处理、线段拆分
│   ├── ColorMapper     — 速度→颜色映射 (固定/自适应/自定义 三模式)
│   └── TimeEngine      — 共享时间轴引擎，事件驱动
├── L.TrackReplay.Layers
│   ├── TrackLayer       — 速度着色轨迹线 (多线段 LineString)
│   ├── PointClusterLayer — 轨迹点聚合 (MarkerCluster)
│   ├── MovingIndicator  — 移动对象指示器 (带方向旋转)
│   ├── DynamicRoute     — 动态路线着色 (已行进/未行进)
│   └── StaticLayer      — 普通 GeoJSON 图层
├── L.TrackReplay.Controls
│   ├── PlaybackControl  — 播放/暂停/停止/循环/速度
│   ├── TimelineControl  — 进度条 + 时间戳显示 + 时间编辑
│   ├── ViewFollowControl — 地图视角跟随控制
│   └── ColorLegend      — 速度颜色条图例
└── L.TrackReplay.Util
    ├── GeoUtils         — 地理计算 (距离、方位角)
    └── TimeUtils        — 时间格式化
```

## 数据流

```
用户 GeoJSON (FeatureCollection)
  → DataParser.parse(featureCollection)
    → 分离普通 Feature 与 TimestampEdgeoJSON Feature
    → 对每条 TimestampEdgeoJSON LineString:
        1. 校验 times 数组长度 == coordinates 长度
        2. 如缺少 speeds → 自动计算 (距离/时间差)
        3. 根据 ColorMapper 模式确定颜色
        4. 如有 styles/speeds/popups → 拆分为逐线段 Feature
        5. 按 layerPath 组织到图层树
    → 返回 { layerTree, timeRange, features }
  → LayerFactory 创建各图层对象 (返回 L.Layer / L.FeatureGroup)
  → 用户可自行装配图层，或使用 L.TrackReplay 一键绑定
  → TimeEngine 驱动时间推进 → 各图层响应 tick 事件
```

## TimestampEdgeoJSON 规范

在标准 GeoJSON Feature 的 properties 中扩展:

| 属性 | 类型 | 必需 | 说明 |
|------|------|------|------|
| isTimestampedgeojson | boolean | 是 | 标记为时序数据 |
| times | number[] | 是 | Unix 时间戳 (ms 或 s)，长度 = coordinates.length |
| speeds | number[] | 否 | 速度数组 (km/h)，长度 = coordinates.length - 1 |
| styles | object[] | 否 | 逐线段样式，长度 = coordinates.length - 1 |
| popups | string[] | 否 | 逐线段弹窗内容，长度 = coordinates.length - 1 |
| layerPath | string[] | 是 | 图层树路径，如 ["group", "subgroup"] |
| drawMovingIndicator | boolean | 否 | 是否绘制移动指示器 |
| layerVisibility | boolean | 否 | 图层默认可见性 |

## 颜色映射模式

1. **固定模式 (fixed)**: 0 km/h → 蓝色, 200 km/h → 红色
2. **自适应模式 (adaptive)**: 取全部速度的 P5–P95 分位，蓝→紫 HSV 渐变
3. **自定义模式 (custom)**: 用户提供 `{colors, index, vmin, vmax}` 配置

## 图层拆分策略

对每条 TimestampEdgeoJSON LineString:

```
if style AND styles    → style 为基础，styles[i] 逐段覆盖
if style AND NOT styles → 不拆分，整条使用 style
if NOT style AND styles → 计算速度 + 按 styles 拆分
if NOT style AND NOT styles → 自动计算速度 + 颜色 + 拆分
```

## 事件系统

| 事件 | 触发时机 | 参数 |
|------|----------|------|
| trackreplay:start | 开始播放 | { time } |
| trackreplay:pause | 暂停 | { time } |
| trackreplay:stop | 停止 (回到起点) | { time } |
| trackreplay:finished | 播放到结尾 | { time } |
| trackreplay:tick | 每个时间帧 | { time, progress } |
| trackreplay:timechange | 时间变化 (含拖拽) | { time, progress } |
| trackreplay:speedchange | 速度改变 | { speed } |

## 目录结构

```
src/
├── TrackReplay.js          # 主入口，注册到 L 命名空间
├── TrackReplay.css         # 样式
├── core/
│   ├── DataParser.js       # 数据解析与处理
│   ├── ColorMapper.js      # 颜色映射引擎
│   ├── TimeEngine.js       # 时间推进引擎
│   └── LayerTreeBuilder.js # 图层树构建
├── layers/
│   ├── TrackLayer.js       # 轨迹线图层
│   ├── PointClusterLayer.js # 点聚合图层
│   ├── MovingIndicator.js  # 移动指示器
│   ├── DynamicRoute.js     # 动态路线着色
│   └── StaticLayer.js      # 静态 GeoJSON 图层
├── controls/
│   ├── PlaybackControls.js # 播放控制 UI
│   ├── TimelineControl.js  # 时间轴控制
│   ├── ViewFollowControl.js # 视角跟随
│   └── ColorLegend.js      # 颜色图例
└── utils/
    ├── GeoUtils.js          # 地理工具
    └── TimeUtils.js         # 时间工具

examples/
├── templates/
│   └── demo.html.jinja2    # Jinja2 模板 (Python 服务端渲染)
└── server.py               # Python 开发服务器 (FastAPI)
```

## 构建与发布

```bash
npm run build     # Rollup 打包 (UMD + IIFE + ESM + CJS)
npm run dev       # 开发模式 (watch)
npm publish       # 发布到 npm
```

## Python 调试案例

`examples/server.py` 提供基于 FastAPI + Jinja2 的开发服务器:
- 自动生成示例数据
- 渲染 Jinja2 模板注入数据
- 热重载支持

用户使用流程:
1. 用 Python 处理数据 → 生成 GeoJSON FeatureCollection
2. 将数据填入 Jinja2 模板
3. 浏览器打开查看效果
