# Vendored Liquid Glass

Source: https://github.com/lucaperullo/simple-liquid-glass/tree/9f1ca87d360d9a1c79a1f0e318ab804156c8f9c1

MIT. Optical shaders unchanged. TUAT patches: cancellable ResizeObserver render; bounded 384px bottom-viewport capture with offscreen subtree pruning; defer capture until input/navigation settles; crop-aware sampling with live CSS fallback outside the cached strip. System fonts only. html-to-image copies only resolved paint/layout properties instead of every computed CSS variable. Patch source and reproducible build are in ops/glass/. Build dependencies: esbuild 0.25.12, html-to-image 1.11.11; target safari15. Retained MIT notices beside this file.
