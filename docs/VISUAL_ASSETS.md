# 黄金主视觉资产

最终动态主视觉为本地 WebGL 三维实体螺旋带，源文件为 `assets/gold-geometry.js` 和 `assets/gold-world.js`。它包含厚度、倒角、闭合端面、深度遮挡与物理金属反射，直接按屏幕像素密度渲染。

## 三维材质与许可

- 渲染：本地固定版本 Three.js 0.180.0，`MeshPhysicalMaterial`，金属度 1，线性空间光照与 ACES 色调映射；运行时无需外部 CDN。
- 反射环境：[Studio Small 03](https://polyhaven.com/a/studio_small_03)，Greg Zaal / Poly Haven，CC0。原始 1K HDR 随站点保存，运行时压缩最亮反射峰值，保留黄金高光颜色。
- Three.js 与 HDRLoader 采用 MIT 许可，见 `assets/vendor/THREE-LICENSE.txt`。HDR 来源与许可见 `assets/environment/LICENSE.txt`。
- 表面细节：本地生成桌面 2048 × 2048、触屏 1024 × 1024 切线空间法线与粗糙度贴图。非均匀分布的浅划痕具有不同长度、方向、曲率和深浅，叠加 60 处微小凹点与局部抛光差异；保留干净区域，避免连续平行纹理。纹理随模型与反射一起转动。
- 抗锯齿：桌面 1200 段螺旋细分、触屏 720 段、10 段倒角、MSAA 与超采样；高光通过法线导数过滤控制亚像素闪烁。
- 几何细节：金属带正面轻微拱起，轴线与表面有克制的不规则起伏，边缘有厚度和倒角；瑕疵只影响装饰模型。

下面保留的生成图像用于无 WebGL 环境的静态备用画面。

## 材质细节修订

- 模式：内置 `image_gen`，以上一版主视觉为编辑目标。
- 文件：`assets/gold-sculpture-master.png`
- 实际输出：1672 × 941。提示词请求了 3840 × 2160，但工具实际未输出该尺寸，因此不将备用图像标为原生 4K。
- 正常三维舞台不受该备用图像的分辨率限制。

最终编辑提示词：

Keep the approved twisted gold sculpture composition; refine optical detail, material and highlights for a large display. Requested 3840x2160; actual output 1672x941.

- 模式：内置 `image_gen`，全新生成。
- 文件：`assets/gold-sculpture.png`
- 用途：AURUM 首页全幅金属雕塑；艺术图像，不代表真实黄金产品、报价或行情图表。
- 视觉方向：近黑空间、大尺度黄金、克制排版、光影与留白。

## 最终生成提示词

Use case: stylized-concept. Asset type: full bleed cinematic hero art for AURUM, a serious gold market research website. Primary request: a single monumental sculptural ribbon made from thick solid 24 karat gold, rising and twisting once like an architectural folded metal monolith, tangible enormous weight and refined restrained luxury. Scene/backdrop: seamless near black #080909 studio void, no horizon. Composition/framing: widescreen 16:9 editorial photograph, sculpture occupies the RIGHT 60 percent of the image from bottom to upper edge, left 40 percent almost entirely dark negative space reserved for live HTML typography. Dramatic macro perspective, lower portion cropped beyond frame for scale. Lighting/mood: powerful cinematic chiaroscuro, a sharp warm white grazing key light revealing gold ridges and deep shadows, spectacular but precise gold reflections, dark amber shaded metal, very fine micro brushed surface. Material photorealistic physically based polished and brushed gold, luxurious product photography, extraordinary sculptural geometry, museum level composition, minimal and bold. No coins, no stacked ingots, no financial charts, no particles, no halos, no orbits, no gradients blobs, no sparkles, no pedestal, no extra objects, absolutely NO text, letters, logos, watermarks or UI elements. Large quiet black space surrounding one singular object, understated sophisticated visual impact.

