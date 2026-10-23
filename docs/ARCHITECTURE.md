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

场景渲染与价格计算无依赖。可见性、减少动态偏好、GPU 上下文丢失、恢复及离开页面均有独立生命周期处理。无 GPU 时保留静态备用图像。桌面按设备像素密度渲染至 2 倍，普通密度屏幕至少以 1.5 倍采样；触屏上限 2 倍并以约 30 帧运行，另以像素预算限制超大画布。金属细节由程序材质生成，不受备用图像分辨率限制。

物理渲染使用本地固定的 Three.js 0.180.0 与 HDRLoader，不依赖 CDN。摄影棚 HDR 经 PMREM 预过滤为环境反射；压缩捕获环境中的极亮灯箱，避免黄金表面裁切为纯白。法线、切线、粗糙度和各向异性共同控制反射。桌面 2048 像素、触屏 1024 像素材质数据包含非均匀分布的浅划痕、浅凹点与缓慢变化的抛光区域；划痕长度、方向、深度与曲率不同，并保留干净区域。模型表面另有细微几何起伏，连续转动时会改变轮廓与光线。桌面螺旋带细分为 1200 段，触屏 720 段，倒角为 10 段；MSAA、超采样与基于法线导数的高光粗糙度过滤共同控制边缘和亚像素高光锯齿。

渲染器、环境图、材质及纹理在离开页面或初始化失败时释放。模块或 HDR 加载失败时直接显示备用图像。自动检查递归验证本地模块依赖和 HDR 文件存在，回归检查网格正面绕序与切线正交性，避免真实金属材质下出现破面或翻面。

界面使用分层透明度：概览卡片约 70–84% 的深色底；图表、报告和表格约 81–88%；背景虚化并降低亮度，绘图区和输入框增加局部深色层。正文和数值不设置整体透明度。系统减少透明度时使用实色卡片。
