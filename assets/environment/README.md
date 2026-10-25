# Studio lighting for the gold sculpture

The source `studio-small-03-1k.hdr` and its CC0 attribution in LICENSE.txt are retained.
The runtime uses `studio-lighting-1k.webp` (1024 × 512, 35,664 bytes) instead of the
1,686,299-byte RGBE file. This is the same photographed studio, with the same
resolution and highlight compression previously applied in the browser; the gold
surface maps, material parameters and camera poses are unchanged.

For each source linear RGB pixel, compute RGB / (4.5 + max(RGB)), encode each
channel with the standard sRGB transfer function, round to 8 bits, and encode
WebP at quality 96, method 6. At runtime decode sRGB to linear and multiply by 4.5,
then convert to half floats before the existing PMREM calculation. RGB row order
and the equirectangular texture's flipY are preserved. The compact image is a
lighting cache rather than a photograph intended for display. It introduces
small quantization/compression differences; it is not lossless source HDR.

Measured against the encoded source: sRGB RMSE 1.122 / 255, PSNR 47.13 dB.
Transfer size is 97.89% smaller. These are asset measurements, not a claim about
end-to-end loading speed or connectivity in mainland China.

Compact asset SHA-256:
`0d4ae946341da28392facb65272aca54710386d6edeab9b18f79eaf57b80e71c`
