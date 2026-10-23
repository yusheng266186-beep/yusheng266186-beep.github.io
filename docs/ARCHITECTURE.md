# AURUM architecture

The site remains buildless HTML, CSS and classic JavaScript so both GitHub Pages and direct-file use are supported. Existing v3 portfolio and v5 configuration keys are retained.

`data/embedded-data.js` supplies the offline seed. `core.js` exposes pure, independently tested domain operations through a browser global and CommonJS export. `scene.js` owns hash navigation and motion, and emits `aurum:chapter` after revealing a section. `app.js` adapts public providers, loads static files, renders the views and redraws visible canvases. No animation writes financial state.

## Invariants

1. `asOf` is a provider's observation time. `fetchedAt` is a request time. Missing observation times remain missing. Snapshot provenance cannot become live merely by loading it.
2. Historical series are validated, sorted and deduplicated. Technical indicators use the recorded daily series. The chart may overlay one explicitly identified live point without duplicating a day.
3. Scenario cards and charts use `scenarioAt`. They are parameterized extrapolations with no calibrated probabilities. Missing history produces an empty state.
4. Order previews and execution use the same `core.order`. A transaction validates size, cost, provenance, cash and single-order limits before updating holdings. Writes must succeed before a transaction is confirmed.
5. Persisted account content is compared before a write, and storage events load other tabs' updates. An invalid saved account is not overwritten by a fallback trade. Explicit reset and validated restore are the recovery paths.
6. Official feed results replace only healthy sources' items. Failed sources retain their dated records. A total outage fails instead of writing an empty success snapshot.
7. Original fonts ship with licenses. The gold sculpture is decorative three-dimensional geometry and is labeled separately from market charts.

## Deployment

`checks.yml` validates static DOM references, JavaScript syntax, JSON files and domain regressions. `pages.yml` deploys main and also responds to successful trusted main-branch refresh workflows. Data-refresh jobs share a concurrency group and have bounded timeouts. Refresh failures retain prior data and expose a failed workflow status.

## Verification boundary

Automated tests cover domain behavior and partial-source outages. Desktop and phone UI flows are checked in an actual browser. Third-party endpoints may independently fail or restrict browser access; the UI always carries provenance, timestamps and observable fallbacks. No browser test submits a real financial order.

## 持续空间层

`gold-geometry.js` 构建具有三维坐标、单位法线、厚度、倒角与闭合端面的参数化螺旋实体。`gold-world.js` 使用同一个固定 WebGL 画布，启用深度测试；转动发生在模型的空间轴上，而非图片平面。三维遮挡与固定摄影棚环境反射共同形成空间感。

章节姿态、滚动和指针输入经过阻尼，滚动将转角、轴向位置和镜头距离联动。转角按最短路径变化并限制角速度，返回首页不会突然快速整圈旋转。场景每次切换不销毁，不重载图片。相机与材质均不改变价格或账户状态。

场景渲染与价格计算无依赖。可见性、减少动态偏好、GPU 上下文丢失、恢复及离开页面均有独立生命周期处理。无 GPU 时保留静态备用图像。桌面与触屏均以最多 60 次/秒绘制雕塑，高刷新率屏幕不重复加倍绘制。按设备密度采样至 2 倍，普通桌面目标以 1.25 倍采样，仍受像素预算限制；桌面 830 万、触屏 180 万像素预算限制超大画布。持续掉帧时逐步降低绘制密度，连续流畅十秒后小步恢复，不重建网格、纹理或材质。金属细节由程序材质生成，不受备用图像分辨率限制。

物理渲染使用本地固定的 Three.js 0.180.0 与 HDRLoader，不依赖 CDN。摄影棚 HDR 经 PMREM 预过滤为环境反射；压缩捕获环境中的极亮灯箱，避免黄金表面裁切为纯白。法线、切线、粗糙度和各向异性共同控制反射。桌面 2048 像素、触屏 1024 像素材质数据包含非均匀分布的浅划痕、浅凹点与缓慢变化的抛光区域；划痕长度、方向、深度与曲率不同，并保留干净区域。模型表面另有细微几何起伏，连续转动时会改变轮廓与光线。桌面螺旋带细分为 1200 段，触屏 720 段，倒角为 10 段；MSAA、超采样与基于法线导数的高光粗糙度过滤共同控制边缘和亚像素高光锯齿。

渲染器、环境图、材质及纹理在离开页面或初始化失败时释放。模块或 HDR 加载失败时直接显示备用图像。自动检查递归验证本地模块依赖和 HDR 文件存在，回归检查网格正面绕序与切线正交性，避免真实金属材质下出现破面或翻面。

界面使用分层透明度：概览卡片约 70–84% 的深色底；图表、报告和表格约 81–88%；通过深色渐变层控制背景亮度，绘图区和输入框增加局部深色层，不对实时三维背景叠加多层 backdrop-filter。正文和数值不设置整体透明度。系统减少透明度时使用实色卡片。

## 圆角界面与周期选择

卡片、次级表面与控件共用圆角变量。数值统一使用本地 Inter 可变字体，关键金额与输入开启等宽数字和光学尺寸适配，图表刻度与日期沿用同一字形，并保留 OFL 许可。账户以总权益为主卡，现金和黄金比例使用真实账户值；委托预览和风险边界仍调用原有计算核心。

`forecastHorizon` 仅是当前页面的观察周期状态，默认一个月。点击和方向键同步周期按钮、`aria-pressed`、数值摘要和画布区间标记；它不修改因子假设、行情或持仓。水平周期列表在渲染后保留滚动位置。章节切换先取消前序动画，再依次引入标题与卡片；页内链接只滚动当前章节，不把表单锚点误判成新章节。

## 滚动与合成稳定性

固定舞台使用大视口高度 `lvh`，移动浏览器工具栏变化不会反复改变画布尺寸。resize 只设置待处理标记，下一帧比较真实尺寸和采样率；相同时不重建缓冲，相异时以一次 setDrawingBufferSize 后立即绘制。滚动事件只收集目标值，空间运动在单个 RAF 中阻尼更新；进度条变量局限于小型指示器，不逐帧污染根节点样式。

滚入视野的阅读卡片不做整卡透明度或 transform 入场，避免因子面板首次出现时从可见突然变暗，以及创建、撤销独立合成表面的闪动。章节仅保留标题和小卡片动效，不对整页做淡入。滑杆与图表悬停更新合并到下一帧，图表不在同尺寸时重置画布缓冲；仅移动工具栏引起的高度变化不触发图表重画。

`render-policy.js` 的回归覆盖 60/120/144 Hz 绘制节奏、像素/纹理边界、持续压力降级与渐进恢复。添加 `?perf=1` 可在 goldWorld 的 data-performance 读取两秒采样的 RAF 帧率、p95、绘制次数、缓冲重建次数和上下文丢失次数；正常访问不收集这些指标。

网格与程序材质通过 gold-worker.js 在后台线程生成，数组缓冲以 transfer 方式传给渲染线程；正常生成结果与移出主线程前的材质数据逐字节相同。Worker 不可用或直接打开 file: 时使用较小材质图回退，离开页面会终止尚未结束的计算。

驱动假设改为默认关闭的原生 details 控制台，摘要显示历史动量、其他非中性项数及综合方向分。展开后用三个可键盘切换的 tab 分组，一次显示三条细线滑杆。隐藏分组的控件不参与键盘焦点，切换分组保留原假设值，摘要随情景渲染更新。展开与收起不做高度、透明度或大表面位移动画。

## 研究手记与上下文

research-journal.js 负责纯快照校验、版本化存储、追加、移除/撤销和跨时点比较；journal-ui.js 负责视图、原生 dialog 和事件，app.js 通过回调提供数据，记录模块不读取或改写账户存储。读入损坏、重复 ID、无效报价/区间、容量上限及写入失败都不会产生成功记录；跨标签存储变动重读。移除可在本页撤销，导出保留原 JSON。快照与实时状态分离，重用仅恢复假设与观察周期，并按当前报价重新计算。

周期卡片和因子滑杆复用现有节点，行情刷新不销毁焦点或拖拽对象。手动因子覆盖标记独立于自动基线，只有明确恢复时清除。外部报告关联输入指纹；行情、周期、因子、账户或研究输入改变后保留旧结果并显示过期提示，滑杆不静默覆盖外部报告。

## GLM 审查后的恢复与预算

上下文丢失后保留压缩 HDR 像素；恢复事件的下一 RAF 等待 Three.js 重建内部状态，再生成新的 PMREM 渲染目标、重画并显示雕塑。无法恢复时保留海报。保留的 HDR 在清理时释放。质量 governor 改用相邻实际绘制间隔与 render() CPU 耗时的较大值，兼看平均节奏与慢帧比例，避免高刷新率原始 RAF 间隔的检测盲区。

## 4.1 阅读路径与快照恢复

研究页的事实摘要仅使用有效报价与已记录日线，官方列表仅使用原文记录。类别、关键词和分页为独立视图状态，不改变来源文件；默认五条，继续阅读每次增加五条。列表 HTML 未改变时复用 DOM，避免轮询破坏焦点。新闻的关键词分数仅作主题筛选，不展示为价格方向。

情景与数据基线共用 scenarioModel 和同一组输入时点。自动基线只含历史动量及有效溢价，信号不可用时归零；手动覆盖保持独立。带入练习保留只读情景依据，默认转入买入预览，不改变历史练习许可，也不成交；实际确认仍调用 core.order/execute。备注原文保留，独立 scenarioBasis 随成交、JSON 与 CSV 保存。

手记恢复在纯存储模块中完整验证后一次性合并；相同 ID 相同内容跳过，冲突或超容量失败，不部分导入。界面按 ID 与不可变快照复用行，仅更新后来报价的比较值。撤销后的排序依据原创建时间。

scene 的统一目标解析器从任意页内锚点确定所属章节，先揭示详情层级，再定位和转移焦点。更新 URL 保留锚点；直接打开、刷新和历史导航共用解析路径。同章定位不重置三维章节姿态；修饰键点击保留浏览器默认行为。章节间历史返回恢复本次页面已记录的阅读位置。

本地报告按四种主题生成各自内容；外部生成期间使用 loading 状态，自动刷新不覆盖输出。4.1.0 修改过的入口样式与脚本使用版本查询参数，避免部署后 HTML 与旧缓存脚本混用；更新这些文件时需同步递增入口版本。
